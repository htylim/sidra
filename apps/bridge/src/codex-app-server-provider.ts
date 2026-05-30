import type {
  AgentProvider,
  AgentSendInput,
  AgentSession,
  AgentPermissionRequester,
  ProviderDisplayTitleSource,
  SafeProviderTurnEvent
} from "./session-manager.js";
import type { AppServerNotification, AppServerRequest } from "./codex-app-server-client.js";
import type { SafeActivityDetail, SafeActivityToolKind, SafeAgentActivity } from "@sidra/protocol";
import { buildSidraCodexThreadTitle } from "./codex-thread-title.js";

type AppServerClientBoundary = {
  request(method: string, params: unknown): Promise<unknown>;
  requestWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
  onNotification(handler: (notification: AppServerNotification) => void): () => void;
  onServerRequest(handler: (request: AppServerRequest) => void): () => void;
  respond(id: number | string, result: unknown): void;
};

export type CodexAppServerProviderOptions = {
  appServer: AppServerClientBoundary;
  workingDirectory: string;
};

type TextUserInput = {
  type: "text";
  text: string;
  text_elements: [];
};

type QueuedTurnEvent =
  | { kind: "event"; event: SafeProviderTurnEvent }
  | { kind: "error"; error: Error };

type PendingTurnRead = {
  resolve(result: IteratorResult<SafeProviderTurnEvent>): void;
  reject(error: Error): void;
};

const SIDRA_CODEX_SERVICE_NAME = "sidra";
const DEFAULT_SIDRA_CODEX_THREAD_EPHEMERAL = false;
const SIDRA_CODEX_THREAD_NAME_SET_TIMEOUT_MS = 500;

export function createCodexAppServerProvider(options: CodexAppServerProviderOptions): AgentProvider {
  return {
    id: "codex",
    async createSession() {
      const response = await startThread(options.appServer, options.workingDirectory);
      return new CodexAppServerSession(options.appServer, extractThreadId(response), options.workingDirectory);
    }
  };
}

async function startThread(appServer: AppServerClientBoundary, workingDirectory: string): Promise<unknown> {
  const legacyParams = {
    cwd: workingDirectory,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "read-only"
  };
  try {
    return await appServer.request("thread/start", {
      ...legacyParams,
      serviceName: SIDRA_CODEX_SERVICE_NAME,
      ephemeral: DEFAULT_SIDRA_CODEX_THREAD_EPHEMERAL
    });
  } catch (error) {
    if (!isThreadStartCompatibilityError(error)) throw error;
    return appServer.request("thread/start", legacyParams);
  }
}

function isThreadStartCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Invalid params|unknown field|failed to deserialize/i.test(message);
}

class CodexAppServerSession implements AgentSession {
  private threadNameDecisionMade = false;

  constructor(
    private readonly appServer: AppServerClientBoundary,
    private readonly threadId: string,
    private readonly workingDirectory: string
  ) {}

  async *send(
    input: AgentSendInput,
    signal: AbortSignal,
    permissions: AgentPermissionRequester
  ): AsyncIterable<SafeProviderTurnEvent> {
    await this.decideThreadNameOnce(input.displayTitleSource);
    const turn = new CodexAppServerTurn(this.appServer, this.threadId, this.workingDirectory);
    yield* turn.run(input, signal, permissions);
  }

  async close(): Promise<void> {
    await this.appServer.request("thread/unsubscribe", { threadId: this.threadId });
  }

  private async decideThreadNameOnce(source: ProviderDisplayTitleSource | undefined): Promise<void> {
    if (this.threadNameDecisionMade) return;
    this.threadNameDecisionMade = true;
    if (!source) return;

    const title = buildSidraCodexThreadTitle(source);
    if (!title) return;

    try {
      await this.appServer.requestWithTimeout(
        "thread/name/set",
        { threadId: this.threadId, name: title },
        SIDRA_CODEX_THREAD_NAME_SET_TIMEOUT_MS
      );
    } catch {
      // Thread naming is best effort. A naming failure must not block chat.
    }
  }
}

class CodexAppServerTurn {
  private readonly queuedEvents: QueuedTurnEvent[] = [];
  private pendingRead: PendingTurnRead | undefined;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeServerRequests: (() => void) | undefined;
  private turnId: string | undefined;
  private finished = false;
  private readonly commandItemIds = new Set<string>();

  constructor(
    private readonly appServer: AppServerClientBoundary,
    private readonly threadId: string,
    private readonly workingDirectory: string
  ) {}

  async *run(input: AgentSendInput, signal: AbortSignal, permissions?: AgentPermissionRequester): AsyncIterable<SafeProviderTurnEvent> {
    this.unsubscribe = this.appServer.onNotification((notification) => this.acceptNotification(notification));
    this.unsubscribeServerRequests = this.appServer.onServerRequest((request) => {
      void this.acceptServerRequest(request, permissions).catch(() => undefined);
    });

    try {
      const turnStartResponse = await this.appServer.request("turn/start", {
        threadId: this.threadId,
        input: [toTextUserInput(input.prompt)],
        cwd: this.workingDirectory,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false }
      });
      this.turnId = extractTurnId(turnStartResponse);

      if (signal.aborted) {
        const event = await this.cancel();
        if (event) yield event;
        return;
      }

      const abortTurn = () => {
        void this.cancel()
          .then((event) => {
            if (event) this.pushEvent(event);
          })
          .catch(() => undefined);
      };
      signal.addEventListener("abort", abortTurn, { once: true });
      try {
        while (true) {
          const next = await this.readNextEvent();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        signal.removeEventListener("abort", abortTurn);
      }
    } finally {
      this.unsubscribe?.();
      this.unsubscribeServerRequests?.();
    }
  }

  private async cancel(): Promise<SafeProviderTurnEvent | undefined> {
    if (this.finished) return undefined;
    this.finished = true;
    if (this.turnId) {
      await this.appServer.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    }
    return { type: "assistant.cancelled" };
  }

  private acceptNotification(notification: AppServerNotification): void {
    if (notification.method === "item/agentMessage/delta") {
      const delta = parseAgentMessageDelta(notification.params);
      if (!delta || delta.threadId !== this.threadId || delta.turnId !== this.turnId) return;
      this.pushEvent({ type: "assistant.text.delta", text: delta.delta });
      return;
    }

    if (notification.method === "item/started" || notification.method === "item/completed") {
      const activity = parseItemActivity(notification.method, notification.params);
      if (!activity || activity.threadId !== this.threadId || activity.turnId !== this.turnId) return;
      if (activity.activity.kind === "tool" && activity.activity.toolKind === "command") {
        this.commandItemIds.add(activity.activity.itemId);
      }
      this.pushEvent({ type: "assistant.activity", activity: activity.activity });
      return;
    }

    if (notification.method === "item/reasoning/summaryTextDelta") {
      const activity = parseReasoningSummaryActivity(notification.params);
      if (!activity || activity.threadId !== this.threadId || activity.turnId !== this.turnId) return;
      this.pushEvent({ type: "assistant.activity", activity: activity.activity });
      return;
    }

    if (notification.method === "item/commandExecution/outputDelta") {
      const activity = parseCommandOutputActivity(notification.params);
      if (!activity || activity.threadId !== this.threadId || activity.turnId !== this.turnId) return;
      if (activity.activity.kind !== "command_output_delta") return;
      if (!this.commandItemIds.has(activity.activity.itemId)) return;
      this.pushEvent({ type: "assistant.activity", activity: activity.activity });
      return;
    }

    if (notification.method === "turn/completed") {
      const completed = parseTurnCompleted(notification.params);
      if (!completed || completed.threadId !== this.threadId || completed.turnId !== this.turnId) return;
      this.finished = true;
      this.pushEvent({ type: "assistant.done" });
      return;
    }

    if (notification.method === "error") {
      const error = parseErrorNotification(notification.params);
      if (!error || error.threadId !== this.threadId || error.turnId !== this.turnId) return;
      this.finished = true;
      this.pushError(new Error(error.message));
    }
  }

  private async acceptServerRequest(request: AppServerRequest, permissions: AgentPermissionRequester | undefined): Promise<void> {
    if (!permissions) return;
    const providerRequest = this.toProviderPermissionRequest(request);
    if (!providerRequest) return;
    let sidraDecision: "allow_once" | "allow_for_session" | "deny";
    try {
      sidraDecision = (await permissions.requestPermission(providerRequest)).decision;
    } catch {
      sidraDecision = "deny";
    }
    this.appServer.respond(request.id, this.toAppServerResponse(request, sidraDecision));
  }

  private toProviderPermissionRequest(request: AppServerRequest) {
    if (request.method === "item/commandExecution/requestApproval") {
      const params = parseCommandApprovalParams(request.params);
      if (!params || params.threadId !== this.threadId || params.turnId !== this.turnId) return null;
      return {
        permissionKey: `command:${params.itemId}`,
        title: "Approve command",
        description: params.reason,
        metadata: {
          toolName: "Command",
          commandPreview: params.command
        }
      };
    }

    if (request.method === "item/fileChange/requestApproval") {
      const params = parseFileChangeApprovalParams(request.params);
      if (!params || params.threadId !== this.threadId || params.turnId !== this.turnId) return null;
      return {
        permissionKey: `file-change:${params.itemId}`,
        title: "Approve file changes",
        description: params.reason,
        metadata: {
          toolName: "File change"
        }
      };
    }

    if (request.method === "item/tool/requestUserInput") {
      const params = parseToolUserInputParams(request.params);
      if (!params || params.threadId !== this.threadId || params.turnId !== this.turnId) return null;
      return {
        permissionKey: `tool-input:${params.itemId}`,
        title: "Answer tool input request",
        description: params.questions.map((question) => question.question).join("\n"),
        metadata: {
          toolName: "Tool input"
        }
      };
    }

    return null;
  }

  private toAppServerResponse(request: AppServerRequest, decision: "allow_once" | "allow_for_session" | "deny"): unknown {
    if (request.method === "item/tool/requestUserInput") {
      const params = parseToolUserInputParams(request.params);
      return { answers: toToolUserInputAnswers(params?.questions ?? [], decision) };
    }
    return { decision: toAppServerApprovalDecision(decision) };
  }

  private readNextEvent(): Promise<IteratorResult<SafeProviderTurnEvent>> {
    const queued = this.queuedEvents.shift();
    if (queued) return this.consumeQueuedEvent(queued);
    if (this.finished) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => {
      this.pendingRead = { resolve, reject };
    });
  }

  private consumeQueuedEvent(queued: QueuedTurnEvent): Promise<IteratorResult<SafeProviderTurnEvent>> {
    if (queued.kind === "error") return Promise.reject(queued.error);
    return Promise.resolve({ done: false, value: queued.event });
  }

  private pushEvent(event: SafeProviderTurnEvent): void {
    const pendingRead = this.pendingRead;
    if (pendingRead) {
      this.pendingRead = undefined;
      pendingRead.resolve({ done: false, value: event });
      return;
    }
    this.queuedEvents.push({ kind: "event", event });
  }

  private pushError(error: Error): void {
    const pendingRead = this.pendingRead;
    if (pendingRead) {
      this.pendingRead = undefined;
      pendingRead.reject(error);
      return;
    }
    this.queuedEvents.push({ kind: "error", error });
  }
}

function toTextUserInput(text: string): TextUserInput {
  return { type: "text", text, text_elements: [] };
}

function extractThreadId(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.thread) || typeof response.thread.id !== "string") {
    throw new Error("Codex App Server thread/start response did not include a thread id");
  }
  return response.thread.id;
}

function extractTurnId(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.turn) || typeof response.turn.id !== "string") {
    throw new Error("Codex App Server turn/start response did not include a turn id");
  }
  return response.turn.id;
}

function parseAgentMessageDelta(params: unknown): { threadId: string; turnId: string; delta: string } | null {
  if (!isRecord(params)) return null;
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string" || typeof params.delta !== "string") return null;
  return { threadId: params.threadId, turnId: params.turnId, delta: params.delta };
}

function parseItemActivity(
  method: string,
  params: unknown
): { threadId: string; turnId: string; activity: SafeAgentActivity } | null {
  if (!isRecord(params) || typeof params.threadId !== "string" || typeof params.turnId !== "string" || !isRecord(params.item)) {
    return null;
  }

  if (method === "item/started") {
    const activity = toToolActivity(params.item, "started");
    if (activity) return { threadId: params.threadId, turnId: params.turnId, activity };
  }

  if (method === "item/completed") {
    const activity = toToolActivity(params.item, "completed");
    if (activity) return { threadId: params.threadId, turnId: params.turnId, activity };
  }

  return null;
}

function parseReasoningSummaryActivity(params: unknown): { threadId: string; turnId: string; activity: SafeAgentActivity } | null {
  if (!isRecord(params) || typeof params.threadId !== "string" || typeof params.turnId !== "string") return null;
  const text = boundedStringField(params, ["delta", "text"]);
  if (!text) return null;
  return { threadId: params.threadId, turnId: params.turnId, activity: { kind: "reasoning_summary_delta", text } };
}

function parseCommandOutputActivity(params: unknown): { threadId: string; turnId: string; activity: SafeAgentActivity } | null {
  if (!isRecord(params) || typeof params.threadId !== "string" || typeof params.turnId !== "string" || typeof params.itemId !== "string") {
    return null;
  }
  const text = boundedStringField(params, ["delta", "text"]);
  if (!text) return null;
  return {
    threadId: params.threadId,
    turnId: params.turnId,
    activity: {
      kind: "command_output_delta",
      itemId: params.itemId,
      stream: toCommandOutputStream(params.stream),
      text
    }
  };
}

function toToolActivity(item: Record<string, unknown>, phase: "started" | "completed"): SafeAgentActivity | null {
  const itemId = typeof item.id === "string" ? item.id : undefined;
  if (!itemId) return null;

  const toolKind = toToolKind(item.type);
  if (!toolKind) return null;

  return {
    kind: "tool",
    itemId,
    toolKind,
    phase,
    title: toolTitle(toolKind),
    details: toolDetails(toolKind, item)
  };
}

function toToolKind(itemType: unknown): SafeActivityToolKind | null {
  if (itemType === "commandExecution") return "command";
  if (itemType === "fileChange") return "file_change";
  if (itemType === "mcpToolCall") return "mcp_tool";
  if (itemType === "dynamicToolCall") return "dynamic_tool";
  if (itemType === "webSearch") return "web_search";
  return null;
}

function toolTitle(toolKind: SafeActivityToolKind): string {
  switch (toolKind) {
    case "command":
      return "Run command";
    case "file_change":
      return "Edit files";
    case "mcp_tool":
      return "Use MCP tool";
    case "dynamic_tool":
      return "Use tool";
    case "web_search":
      return "Search web";
    case "unknown":
      return "Use tool";
  }
}

function toolDetails(toolKind: SafeActivityToolKind, item: Record<string, unknown>): SafeActivityDetail[] {
  switch (toolKind) {
    case "command":
      return detailList([["Command", item.command]]);
    case "file_change":
      return detailList([
        ["Path", item.path],
        ["Operation", item.operation]
      ]);
    case "mcp_tool":
      return detailList([
        ["Server", item.server],
        ["Tool", item.tool ?? item.name]
      ]);
    case "dynamic_tool":
      return detailList([["Tool", item.name ?? item.tool]]);
    case "web_search":
      return detailList([["Query", item.query]]);
    case "unknown":
      return [];
  }
}

function detailList(entries: Array<[string, unknown]>): SafeActivityDetail[] {
  const details: SafeActivityDetail[] = [];
  for (const [label, rawValue] of entries) {
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) continue;
    details.push({ label, value: capDisplayText(rawValue, SAFE_ACTIVITY_DETAIL_VALUE_LIMIT) });
  }
  return details;
}

function boundedStringField(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return capDisplayText(value, SAFE_ACTIVITY_TEXT_LIMIT);
  }
  return undefined;
}

function toCommandOutputStream(stream: unknown): "stdout" | "stderr" | "unknown" {
  if (stream === "stdout" || stream === "stderr") return stream;
  return "unknown";
}

const SAFE_ACTIVITY_DETAIL_VALUE_LIMIT = 2_000;
const SAFE_ACTIVITY_TEXT_LIMIT = 8_000;

function capDisplayText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function parseTurnCompleted(params: unknown): { threadId: string; turnId: string } | null {
  if (!isRecord(params) || typeof params.threadId !== "string" || !isRecord(params.turn) || typeof params.turn.id !== "string") {
    return null;
  }
  return { threadId: params.threadId, turnId: params.turn.id };
}

function parseErrorNotification(params: unknown): { threadId: string; turnId: string; message: string } | null {
  if (!isRecord(params) || typeof params.threadId !== "string" || typeof params.turnId !== "string") return null;
  const message =
    isRecord(params.error) && typeof params.error.message === "string" ? params.error.message : "Codex App Server turn failed";
  return { threadId: params.threadId, turnId: params.turnId, message };
}

function parseCommandApprovalParams(
  params: unknown
): { threadId: string; turnId: string; itemId: string; command?: string; reason?: string } | null {
  if (!isRecord(params)) return null;
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string" || typeof params.itemId !== "string") return null;
  return {
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    command: typeof params.command === "string" ? params.command : undefined,
    reason: typeof params.reason === "string" ? params.reason : undefined
  };
}

function parseFileChangeApprovalParams(
  params: unknown
): { threadId: string; turnId: string; itemId: string; reason?: string } | null {
  if (!isRecord(params)) return null;
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string" || typeof params.itemId !== "string") return null;
  return {
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: typeof params.reason === "string" ? params.reason : undefined
  };
}

type ToolUserInputQuestion = {
  id: string;
  question: string;
  options: Array<{ label: string }> | null;
};

function parseToolUserInputParams(params: unknown): { threadId: string; turnId: string; itemId: string; questions: ToolUserInputQuestion[] } | null {
  if (!isRecord(params)) return null;
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string" || typeof params.itemId !== "string") return null;
  if (!Array.isArray(params.questions)) return null;
  const questions: ToolUserInputQuestion[] = [];
  for (const question of params.questions) {
    const parsedQuestion = parseToolUserInputQuestion(question);
    if (!parsedQuestion) return null;
    questions.push(parsedQuestion);
  }
  return { threadId: params.threadId, turnId: params.turnId, itemId: params.itemId, questions };
}

function parseToolUserInputQuestion(question: unknown): ToolUserInputQuestion | null {
  if (!isRecord(question) || typeof question.id !== "string" || typeof question.question !== "string") return null;
  if (question.options !== null && question.options !== undefined && !Array.isArray(question.options)) return null;
  const options = Array.isArray(question.options) ? parseToolUserInputOptions(question.options) : null;
  if (Array.isArray(question.options) && !options) return null;
  return { id: question.id, question: question.question, options };
}

function parseToolUserInputOptions(options: unknown[]): Array<{ label: string }> | null {
  const parsedOptions: Array<{ label: string }> = [];
  for (const option of options) {
    if (!isRecord(option) || typeof option.label !== "string") return null;
    parsedOptions.push({ label: option.label });
  }
  return parsedOptions;
}

function toToolUserInputAnswers(
  questions: ToolUserInputQuestion[],
  decision: "allow_once" | "allow_for_session" | "deny"
): Record<string, { answers: string[] }> {
  const answers: Record<string, { answers: string[] }> = {};
  for (const question of questions) {
    answers[question.id] = { answers: decision === "deny" ? [] : firstOptionAnswer(question) };
  }
  return answers;
}

function firstOptionAnswer(question: ToolUserInputQuestion): string[] {
  const firstOption = question.options?.[0]?.label;
  return firstOption ? [firstOption] : [];
}

function toAppServerApprovalDecision(decision: "allow_once" | "allow_for_session" | "deny"): "accept" | "acceptForSession" | "decline" {
  if (decision === "allow_once") return "accept";
  if (decision === "allow_for_session") return "acceptForSession";
  return "decline";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
