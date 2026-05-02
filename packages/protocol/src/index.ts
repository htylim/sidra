export const PROTOCOL_VERSION = 1;

export type ProviderId = "codex";

export type PageContext = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  text?: string;
  capturedAt: string;
};

export type ExtensionToBridge =
  | {
      type: "session.start";
      version: 1;
      clientSessionId: string;
      providerId: ProviderId;
    }
  | {
      type: "session.send";
      version: 1;
      clientSessionId: string;
      prompt: string;
      pageContext?: PageContext;
    }
  | { type: "heartbeat"; version: 1 };

export type AgentEvent =
  | { type: "assistant.text.delta"; text: string }
  | { type: "assistant.done" };

export type BridgeToExtension =
  | {
      type: "session.started";
      version: 1;
      clientSessionId: string;
      bridgeSessionId: string;
    }
  | {
      type: "agent.event";
      version: 1;
      clientSessionId: string;
      event: AgentEvent;
    }
  | { type: "session.error"; version: 1; clientSessionId: string; message: string; code?: string }
  | { type: "bridge.ready"; version: 1 }
  | { type: "bridge.error"; version: 1; message: string; code?: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseExtensionToBridge(input: unknown): ParseResult<ExtensionToBridge> {
  if (!isRecord(input)) return invalid("Message must be an object");
  if (input.version !== PROTOCOL_VERSION) return invalid("Unsupported protocol version");

  switch (input.type) {
    case "session.start":
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (input.providerId !== "codex") return invalid("providerId must be codex");
      return { ok: true, value: input as ExtensionToBridge };
    case "session.send":
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isNonEmptyString(input.prompt)) return invalid("prompt is required");
      if (input.pageContext !== undefined && !isPageContext(input.pageContext)) {
        return invalid("pageContext is invalid");
      }
      return { ok: true, value: input as ExtensionToBridge };
    case "heartbeat":
      return { ok: true, value: input as ExtensionToBridge };
    default:
      return invalid("Unknown command");
  }
}

function invalid(error: string): ParseResult<never> {
  return { ok: false, error };
}

function isPageContext(value: unknown): value is PageContext {
  return (
    isRecord(value) &&
    isNonEmptyString(value.url) &&
    isNonEmptyString(value.capturedAt) &&
    optionalString(value.canonicalUrl) &&
    optionalString(value.title) &&
    optionalString(value.text)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}
