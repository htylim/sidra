export const PROTOCOL_VERSION = 2;
export const BRIDGE_PAYLOAD_TOO_LARGE_CODE = "payload_too_large";
export const BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE = "Payload is too large.";
export const BRIDGE_HARD_PAYLOAD_BYTE_LIMIT = 1_000_000;

export type SerializedJsonByteLengthResult =
  | { ok: true; byteLength: number }
  | { ok: false; error: "not_json_serializable" };

export type ProviderId = "codex";

export type PageContextMetadata = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  siteName?: string;
  excerpt?: string;
  byline?: string;
  language?: string;
  capturedAt: string;
};

export type MetadataOnlyPageContextReason =
  | "no_usable_text"
  | "content_too_large"
  | "full_dom_too_large";

export type PageContext =
  | {
      kind: "readable";
      metadata: PageContextMetadata;
      text: string;
      textLength: number;
      extractionMethod: "readability" | "body_inner_text";
    }
  | {
      kind: "full_dom";
      metadata: PageContextMetadata;
      html: string;
      htmlLength: number;
    }
  | {
      kind: "metadata_only";
      metadata: PageContextMetadata;
      reason: MetadataOnlyPageContextReason;
    };

export type ExtensionToBridge =
  | {
      type: "session.start";
      version: 2;
      clientSessionId: string;
      providerId: ProviderId;
    }
  | {
      type: "session.send";
      version: 2;
      clientSessionId: string;
      prompt: string;
      pageContext?: PageContext;
    }
  | { type: "session.cancel"; version: 2; clientSessionId: string }
  | { type: "session.reset"; version: 2; clientSessionId: string }
  | { type: "session.close"; version: 2; clientSessionId: string }
  | { type: "heartbeat"; version: 2 };

export type AgentEvent =
  | { type: "assistant.text.delta"; text: string }
  | { type: "assistant.done" }
  | { type: "assistant.cancelled" };

export type BridgeToExtension =
  | {
      type: "session.started";
      version: 2;
      clientSessionId: string;
      bridgeSessionId: string;
    }
  | {
      type: "agent.event";
      version: 2;
      clientSessionId: string;
      event: AgentEvent;
    }
  | { type: "session.error"; version: 2; clientSessionId: string; message: string; code?: string }
  | { type: "bridge.ready"; version: 2 }
  | { type: "bridge.error"; version: 2; message: string; code?: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function serializedJsonByteLength(value: unknown): SerializedJsonByteLengthResult {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { ok: false, error: "not_json_serializable" };
    return { ok: true, byteLength: utf8ByteLength(serialized) };
  } catch {
    return { ok: false, error: "not_json_serializable" };
  }
}

export function exceedsPayloadByteLimit(byteLength: number, limit: number): boolean {
  return byteLength > limit;
}

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
      if (input.pageContext === undefined) {
        return {
          ok: true,
          value: {
            type: "session.send",
            version: PROTOCOL_VERSION,
            clientSessionId: input.clientSessionId,
            prompt: input.prompt
          }
        };
      }
      {
        const pageContext = parsePageContext(input.pageContext);
        if (!pageContext) return invalid("pageContext is invalid");
        return {
          ok: true,
          value: {
            type: "session.send",
            version: PROTOCOL_VERSION,
            clientSessionId: input.clientSessionId,
            prompt: input.prompt,
            pageContext
          }
        };
      }
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

function parsePageContext(value: unknown): PageContext | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.metadata)) return null;

  const metadata = parsePageContextMetadata(value.metadata);
  if (!metadata) return null;

  switch (value.kind) {
    case "readable":
      if (!hasOnlyKeys(value, ["kind", "metadata", "text", "textLength", "extractionMethod"])) return null;
      if (!isNonEmptyString(value.text)) return null;
      if (typeof value.textLength !== "number" || !Number.isInteger(value.textLength)) return null;
      if (value.textLength !== value.text.length) return null;
      if (value.extractionMethod !== "readability" && value.extractionMethod !== "body_inner_text") return null;
      return {
        kind: "readable",
        metadata,
        text: value.text,
        textLength: value.textLength,
        extractionMethod: value.extractionMethod
      };
    case "full_dom":
      if (!hasOnlyKeys(value, ["kind", "metadata", "html", "htmlLength"])) return null;
      if (!isNonEmptyString(value.html)) return null;
      if (typeof value.htmlLength !== "number" || !Number.isInteger(value.htmlLength)) return null;
      if (value.htmlLength !== value.html.length) return null;
      return {
        kind: "full_dom",
        metadata,
        html: value.html,
        htmlLength: value.htmlLength
      };
    case "metadata_only":
      if (!hasOnlyKeys(value, ["kind", "metadata", "reason"])) return null;
      if (!isMetadataOnlyPageContextReason(value.reason)) return null;
      return {
        kind: "metadata_only",
        metadata,
        reason: value.reason
      };
    default:
      return null;
  }
}

function isMetadataOnlyPageContextReason(value: unknown): value is MetadataOnlyPageContextReason {
  return value === "no_usable_text" || value === "content_too_large" || value === "full_dom_too_large";
}

function parsePageContextMetadata(value: Record<string, unknown>): PageContextMetadata | null {
  if (
    !hasOnlyKeys(value, ["url", "canonicalUrl", "title", "siteName", "excerpt", "byline", "language", "capturedAt"])
  ) {
    return null;
  }
  if (!isNonEmptyString(value.url)) return null;
  if (!isNonEmptyString(value.capturedAt)) return null;
  if (
    !optionalString(value.canonicalUrl) ||
    !optionalString(value.title) ||
    !optionalString(value.siteName) ||
    !optionalString(value.excerpt) ||
    !optionalString(value.byline) ||
    !optionalString(value.language)
  ) {
    return null;
  }

  const metadata: PageContextMetadata = {
    url: value.url,
    capturedAt: value.capturedAt
  };
  if (value.canonicalUrl !== undefined) metadata.canonicalUrl = value.canonicalUrl;
  if (value.title !== undefined) metadata.title = value.title;
  if (value.siteName !== undefined) metadata.siteName = value.siteName;
  if (value.excerpt !== undefined) metadata.excerpt = value.excerpt;
  if (value.byline !== undefined) metadata.byline = value.byline;
  if (value.language !== undefined) metadata.language = value.language;
  return metadata;
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

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;

    if (codePoint <= 0x7f) byteLength += 1;
    else if (codePoint <= 0x7ff) byteLength += 2;
    else if (codePoint <= 0xffff) byteLength += 3;
    else {
      byteLength += 4;
      index += 1;
    }
  }

  return byteLength;
}
