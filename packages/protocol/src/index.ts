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
  | { type: "session.cancel"; version: 1; clientSessionId: string }
  | { type: "session.reset"; version: 1; clientSessionId: string }
  | { type: "session.close"; version: 1; clientSessionId: string }
  | { type: "heartbeat"; version: 1 };

export type AgentEvent =
  | { type: "assistant.text.delta"; text: string }
  | { type: "assistant.done" }
  | { type: "assistant.cancelled" };

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

/**
 * Runtime validation for messages crossing the Native Messaging boundary.
 *
 * Callers should use these parsers before trusting external JSON. The casts
 * below are safe only because each message variant is checked first.
 */
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
    case "session.cancel":
    case "session.reset":
    case "session.close":
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      return { ok: true, value: input as ExtensionToBridge };
    case "heartbeat":
      return { ok: true, value: input as ExtensionToBridge };
    default:
      return invalid("Unknown command");
  }
}

export function parseBridgeToExtension(input: unknown): ParseResult<BridgeToExtension> {
  if (!isRecord(input)) return invalid("Message must be an object");
  if (input.version !== PROTOCOL_VERSION) return invalid("Unsupported protocol version");

  switch (input.type) {
    case "bridge.ready":
      return { ok: true, value: input as BridgeToExtension };
    case "session.started":
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isNonEmptyString(input.bridgeSessionId)) return invalid("bridgeSessionId is required");
      return { ok: true, value: input as BridgeToExtension };
    case "agent.event":
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isAgentEvent(input.event)) return invalid("event is invalid");
      return { ok: true, value: input as BridgeToExtension };
    case "session.error":
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isNonEmptyString(input.message)) return invalid("message is required");
      if (!optionalString(input.code)) return invalid("code is invalid");
      return { ok: true, value: input as BridgeToExtension };
    case "bridge.error":
      if (!isNonEmptyString(input.message)) return invalid("message is required");
      if (!optionalString(input.code)) return invalid("code is invalid");
      return { ok: true, value: input as BridgeToExtension };
    default:
      return invalid("Unknown message");
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

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value)) return false;

  switch (value.type) {
    case "assistant.text.delta":
      return typeof value.text === "string";
    case "assistant.done":
    case "assistant.cancelled":
      return true;
    default:
      return false;
  }
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
