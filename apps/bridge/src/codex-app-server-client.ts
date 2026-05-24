type AppServerMessageId = number | string;

export type AppServerClientInfo = {
  name: string;
  version: string;
};

export type AppServerNotification = {
  method: string;
  params?: unknown;
};

export type AppServerRequest = {
  id: AppServerMessageId;
  method: string;
  params?: unknown;
};

type AppServerResponse = {
  id: AppServerMessageId;
  result?: unknown;
  error?: {
    code?: number | string;
    message?: string;
    data?: unknown;
  };
};

type PendingRequest = {
  resolve(result: unknown): void;
  reject(error: Error): void;
};

export type CodexAppServerClientOptions = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  onNotification?(notification: AppServerNotification): void;
  onServerRequest?(request: AppServerRequest): void;
  onProtocolError?(error: Error): void;
};

/**
 * Owns Codex App Server's newline-delimited JSON-RPC stdio boundary.
 *
 * This module only handles framing, request correlation, and message shape
 * validation. Provider-session policy belongs above this transport boundary.
 */
export class CodexAppServerClient {
  private readonly pendingRequests = new Map<AppServerMessageId, PendingRequest>();
  private readonly notificationHandlers = new Set<(notification: AppServerNotification) => void>();
  private readonly serverRequestHandlers = new Set<(request: AppServerRequest) => void>();
  private nextRequestId = 1;
  private readBuffer = "";
  private closed = false;

  constructor(private readonly options: CodexAppServerClientOptions) {
    options.input.on("data", (chunk: Buffer | string) => this.acceptChunk(chunk));
    options.input.on("end", () => this.close());
    options.input.on("close", () => this.close());
    options.input.on("error", () => this.close());
  }

  async initialize(clientInfo: AppServerClientInfo): Promise<unknown> {
    const result = await this.request("initialize", {
      clientInfo,
      capabilities: {
        experimentalApi: false,
        requestAttestation: false
      }
    });
    this.notify("initialized");
    return result;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex App Server connection closed"));

    const id = this.nextRequestId++;
    const message: AppServerRequest = { id, method, params };
    const response = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
    this.writeMessage(message);
    return response;
  }

  notify(method: string, params?: unknown): void {
    const message: AppServerNotification = params === undefined ? { method } : { method, params };
    this.writeMessage(message);
  }

  respond(id: AppServerMessageId, result: unknown): void {
    this.writeMessage({ id, result });
  }

  onNotification(handler: (notification: AppServerNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  onServerRequest(handler: (request: AppServerRequest) => void): () => void {
    this.serverRequestHandlers.add(handler);
    return () => {
      this.serverRequestHandlers.delete(handler);
    };
  }

  private acceptChunk(chunk: Buffer | string): void {
    this.readBuffer += chunk.toString();

    while (true) {
      const newlineIndex = this.readBuffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const rawMessage = this.readBuffer.slice(0, newlineIndex);
      this.readBuffer = this.readBuffer.slice(newlineIndex + 1);
      if (rawMessage.trim().length === 0) continue;
      this.acceptRawMessage(rawMessage);
    }
  }

  private acceptRawMessage(rawMessage: string): void {
    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.reportProtocolError("Codex App Server emitted invalid JSON");
      return;
    }

    if (!isRecord(message)) {
      this.reportProtocolError("Codex App Server emitted a non-object message");
      return;
    }

    if ("id" in message && "method" in message) {
      const request = parseServerRequest(message);
      if (!request) {
        this.reportProtocolError("Codex App Server emitted an invalid server request");
        return;
      }
      this.options.onServerRequest?.(request);
      for (const handler of this.serverRequestHandlers) handler(request);
      return;
    }

    if ("id" in message) {
      const response = parseResponse(message);
      if (!response) {
        this.reportProtocolError("Codex App Server emitted an invalid response");
        return;
      }
      this.resolveResponse(response);
      return;
    }

    if ("method" in message) {
      const notification = parseNotification(message);
      if (!notification) {
        this.reportProtocolError("Codex App Server emitted an invalid notification");
        return;
      }
      this.options.onNotification?.(notification);
      for (const handler of this.notificationHandlers) handler(notification);
      return;
    }

    this.reportProtocolError("Codex App Server emitted an unknown message");
  }

  private resolveResponse(response: AppServerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.reportProtocolError("Codex App Server emitted a response for an unknown request");
      return;
    }

    this.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message ?? "Codex App Server request failed"));
      return;
    }
    pending.resolve(response.result);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pendingRequests = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();
    for (const pending of pendingRequests) {
      pending.reject(new Error("Codex App Server connection closed"));
    }
  }

  private writeMessage(message: unknown): void {
    this.options.output.write(`${JSON.stringify(message)}\n`);
  }

  private reportProtocolError(message: string): void {
    this.options.onProtocolError?.(new Error(message));
  }
}

function parseServerRequest(message: Record<string, unknown>): AppServerRequest | null {
  if (!isMessageId(message.id) || typeof message.method !== "string") return null;
  return "params" in message
    ? { id: message.id, method: message.method, params: message.params }
    : { id: message.id, method: message.method };
}

function parseNotification(message: Record<string, unknown>): AppServerNotification | null {
  if (typeof message.method !== "string") return null;
  return "params" in message ? { method: message.method, params: message.params } : { method: message.method };
}

function parseResponse(message: Record<string, unknown>): AppServerResponse | null {
  if (!isMessageId(message.id)) return null;
  if ("error" in message) {
    if (!isRecord(message.error)) return null;
    const error = {
      code: isResponseErrorCode(message.error.code) ? message.error.code : undefined,
      message: typeof message.error.message === "string" ? message.error.message : undefined,
      data: message.error.data
    };
    return { id: message.id, error };
  }
  if ("result" in message) return { id: message.id, result: message.result };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessageId(value: unknown): value is AppServerMessageId {
  return typeof value === "number" || typeof value === "string";
}

function isResponseErrorCode(value: unknown): value is number | string | undefined {
  return value === undefined || typeof value === "number" || typeof value === "string";
}
