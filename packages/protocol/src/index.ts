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
  | {
      type: "permission.respond";
      version: 2;
      clientSessionId: string;
      requestId: string;
      decision: PermissionDecision;
    }
  | { type: "heartbeat"; version: 2 };

export type PermissionRequestMetadata = {
  toolName?: string;
  commandPreview?: string;
};

export type PermissionRequest = {
  requestId: string;
  permissionKey: string;
  title: string;
  description?: string;
  metadata?: PermissionRequestMetadata;
};

export type PermissionDecision = "allow_once" | "allow_for_session" | "deny";

export type AgentEvent =
  | { type: "assistant.text.delta"; text: string }
  | { type: "assistant.activity"; activity: SafeAgentActivity }
  | { type: "assistant.done" }
  | { type: "assistant.cancelled" };

export type SafeActivityDetail = {
  label: string;
  value: string;
};

export type SafeAgentActivity =
  | { kind: "reasoning_summary_delta"; text: string }
  | {
      kind: "tool";
      itemId: string;
      toolKind: SafeActivityToolKind;
      phase: "started" | "completed";
      title: string;
      details: SafeActivityDetail[];
    }
  | {
      kind: "command_output_delta";
      itemId: string;
      stream: "stdout" | "stderr" | "unknown";
      text: string;
    };

export type SafeActivityToolKind = "command" | "file_change" | "mcp_tool" | "dynamic_tool" | "web_search" | "unknown";

export type SessionErrorCode =
  | "session_not_started"
  | "turn_in_flight"
  | "no_in_flight_turn"
  | "provider_error"
  | "provider_start_failed"
  | "provider_unavailable"
  | "unsafe_provider_event"
  | "permission_not_found"
  | "permission_response_invalid"
  | "unknown_error";

export type BridgeErrorCode = "invalid_message" | "internal_error" | "payload_too_large" | "codex_setup_failed";

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
  | {
      type: "permission.request";
      version: 2;
      clientSessionId: string;
      request: PermissionRequest;
    }
  | { type: "session.error"; version: 2; clientSessionId: string; message: string; code?: SessionErrorCode }
  | { type: "bridge.ready"; version: 2 }
  | { type: "bridge.error"; version: 2; message: string; code?: BridgeErrorCode };

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
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "providerId"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (input.providerId !== "codex") return invalid("providerId must be codex");
      return {
        ok: true,
        value: {
          type: "session.start",
          version: PROTOCOL_VERSION,
          clientSessionId: input.clientSessionId,
          providerId: input.providerId
        }
      };
    case "session.send":
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "prompt", "pageContext"])) {
        return invalid("Message has invalid fields");
      }
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
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      return {
        ok: true,
        value: {
          type: input.type,
          version: PROTOCOL_VERSION,
          clientSessionId: input.clientSessionId
        }
      };
    case "permission.respond":
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "requestId", "decision"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      if (!isPermissionDecision(input.decision)) return invalid("decision is invalid");
      return {
        ok: true,
        value: {
          type: "permission.respond",
          version: PROTOCOL_VERSION,
          clientSessionId: input.clientSessionId,
          requestId: input.requestId,
          decision: input.decision
        }
      };
    case "heartbeat":
      if (!hasOnlyKeys(input, ["type", "version"])) return invalid("Message has invalid fields");
      return { ok: true, value: { type: "heartbeat", version: PROTOCOL_VERSION } };
    default:
      return invalid("Unknown command");
  }
}

export function parseBridgeToExtension(input: unknown): ParseResult<BridgeToExtension> {
  if (!isRecord(input)) return invalid("Message must be an object");
  if (input.version !== PROTOCOL_VERSION) return invalid("Unsupported protocol version");

  switch (input.type) {
    case "bridge.ready":
      if (!hasOnlyKeys(input, ["type", "version"])) return invalid("Message has invalid fields");
      return { ok: true, value: { type: "bridge.ready", version: PROTOCOL_VERSION } };
    case "session.started":
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "bridgeSessionId"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isNonEmptyString(input.bridgeSessionId)) return invalid("bridgeSessionId is required");
      return {
        ok: true,
        value: {
          type: "session.started",
          version: PROTOCOL_VERSION,
          clientSessionId: input.clientSessionId,
          bridgeSessionId: input.bridgeSessionId
        }
      };
    case "agent.event":
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "event"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      {
        const event = parseAgentEvent(input.event);
        if (!event.ok) return event;
        return {
          ok: true,
          value: {
            type: "agent.event",
            version: PROTOCOL_VERSION,
            clientSessionId: input.clientSessionId,
            event: event.value
          }
        };
      }
    case "permission.request":
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "request"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      {
        const request = parsePermissionRequest(input.request);
        if (!request) return invalid("request is invalid");
        return {
          ok: true,
          value: {
            type: "permission.request",
            version: PROTOCOL_VERSION,
            clientSessionId: input.clientSessionId,
            request
          }
        };
      }
    case "session.error":
      if (!hasOnlyKeys(input, ["type", "version", "clientSessionId", "message", "code"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.clientSessionId)) return invalid("clientSessionId is required");
      if (!isNonEmptyString(input.message)) return invalid("message is required");
      if (!optionalSessionErrorCode(input.code)) return invalid("code is invalid");
      {
        const value: BridgeToExtension = {
          type: "session.error",
          version: PROTOCOL_VERSION,
          clientSessionId: input.clientSessionId,
          message: input.message
        };
        if (input.code !== undefined) value.code = input.code;
        return { ok: true, value };
      }
    case "bridge.error":
      if (!hasOnlyKeys(input, ["type", "version", "message", "code"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.message)) return invalid("message is required");
      if (!optionalBridgeErrorCode(input.code)) return invalid("code is invalid");
      {
        const value: BridgeToExtension = { type: "bridge.error", version: PROTOCOL_VERSION, message: input.message };
        if (input.code !== undefined) value.code = input.code;
        return { ok: true, value };
      }
    default:
      return invalid("Unknown message");
  }
}

export function parseAgentEvent(input: unknown): ParseResult<AgentEvent> {
  if (!isRecord(input)) return invalid("event is invalid");

  switch (input.type) {
    case "assistant.text.delta":
      if (!hasOnlyKeys(input, ["type", "text"])) return invalid("event is invalid");
      if (typeof input.text !== "string") return invalid("event is invalid");
      return {
        ok: true,
        value: { type: "assistant.text.delta", text: input.text }
      };
    case "assistant.activity":
      if (!hasOnlyKeys(input, ["type", "activity"])) return invalid("event is invalid");
      {
        const activity = parseSafeAgentActivity(input.activity);
        if (!activity) return invalid("event is invalid");
        return { ok: true, value: { type: "assistant.activity", activity } };
      }
    case "assistant.done":
      if (!hasOnlyKeys(input, ["type"])) return invalid("event is invalid");
      return { ok: true, value: { type: "assistant.done" } };
    case "assistant.cancelled":
      if (!hasOnlyKeys(input, ["type"])) return invalid("event is invalid");
      return { ok: true, value: { type: "assistant.cancelled" } };
    default:
      return invalid("event is invalid");
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

function parseSafeAgentActivity(value: unknown): SafeAgentActivity | null {
  if (!isRecord(value)) return null;

  switch (value.kind) {
    case "reasoning_summary_delta":
      if (!hasOnlyKeys(value, ["kind", "text"])) return null;
      if (!isBoundedDisplayString(value.text, SAFE_ACTIVITY_TEXT_LIMIT)) return null;
      return { kind: "reasoning_summary_delta", text: value.text };
    case "tool":
      return parseSafeToolActivity(value);
    case "command_output_delta":
      if (!hasOnlyKeys(value, ["kind", "itemId", "stream", "text"])) return null;
      if (!isNonEmptyString(value.itemId)) return null;
      if (value.stream !== "stdout" && value.stream !== "stderr" && value.stream !== "unknown") return null;
      if (!isBoundedDisplayString(value.text, SAFE_ACTIVITY_TEXT_LIMIT)) return null;
      return { kind: "command_output_delta", itemId: value.itemId, stream: value.stream, text: value.text };
    default:
      return null;
  }
}

const SAFE_ACTIVITY_TITLE_LIMIT = 200;
const SAFE_ACTIVITY_DETAIL_LABEL_LIMIT = 80;
const SAFE_ACTIVITY_DETAIL_VALUE_LIMIT = 2_000;
const SAFE_ACTIVITY_TEXT_LIMIT = 8_000;
const SAFE_ACTIVITY_DETAIL_COUNT_LIMIT = 12;
const BLOCKED_ACTIVITY_FIELD_NAMES = new Set([
  "reasoning",
  "chainofthought",
  "thought",
  "prompt",
  "pagecontent",
  "stdout",
  "stderr"
]);

function parseSafeToolActivity(value: Record<string, unknown>): SafeAgentActivity | null {
  if (!hasOnlyKeys(value, ["kind", "itemId", "toolKind", "phase", "title", "details"])) return null;
  if (!isNonEmptyString(value.itemId)) return null;
  if (!isSafeActivityToolKind(value.toolKind)) return null;
  if (value.phase !== "started" && value.phase !== "completed") return null;
  if (!isBoundedDisplayString(value.title, SAFE_ACTIVITY_TITLE_LIMIT)) return null;
  const details = parseSafeActivityDetails(value.details);
  if (!details) return null;
  return {
    kind: "tool",
    itemId: value.itemId,
    toolKind: value.toolKind,
    phase: value.phase,
    title: value.title,
    details
  };
}

function parseSafeActivityDetails(value: unknown): SafeActivityDetail[] | null {
  if (!Array.isArray(value) || value.length > SAFE_ACTIVITY_DETAIL_COUNT_LIMIT) return null;
  const details: SafeActivityDetail[] = [];
  for (const detail of value) {
    if (!isRecord(detail) || !hasOnlyKeys(detail, ["label", "value"])) return null;
    if (!isBoundedDisplayString(detail.label, SAFE_ACTIVITY_DETAIL_LABEL_LIMIT)) return null;
    if (!isBoundedDisplayString(detail.value, SAFE_ACTIVITY_DETAIL_VALUE_LIMIT)) return null;
    if (BLOCKED_ACTIVITY_FIELD_NAMES.has(detail.label.toLowerCase())) return null;
    details.push({ label: detail.label, value: detail.value });
  }
  return details;
}

function isSafeActivityToolKind(value: unknown): value is SafeActivityToolKind {
  return (
    value === "command" ||
    value === "file_change" ||
    value === "mcp_tool" ||
    value === "dynamic_tool" ||
    value === "web_search" ||
    value === "unknown"
  );
}

function parsePermissionRequest(value: unknown): PermissionRequest | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["requestId", "permissionKey", "title", "description", "metadata"])) return null;
  if (!isNonEmptyString(value.requestId)) return null;
  if (!isNonEmptyString(value.permissionKey)) return null;
  if (!isNonEmptyString(value.title)) return null;
  if (!optionalString(value.description)) return null;
  const metadata = value.metadata === undefined ? undefined : parsePermissionRequestMetadata(value.metadata);
  if (value.metadata !== undefined && !metadata) return null;

  const request: PermissionRequest = {
    requestId: value.requestId,
    permissionKey: value.permissionKey,
    title: value.title
  };
  if (value.description !== undefined) request.description = value.description;
  if (metadata) request.metadata = metadata;
  return request;
}

function parsePermissionRequestMetadata(value: unknown): PermissionRequestMetadata | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["toolName", "commandPreview"])) return null;
  if (!optionalString(value.toolName) || !optionalString(value.commandPreview)) return null;
  const metadata: PermissionRequestMetadata = {};
  if (value.toolName !== undefined) metadata.toolName = value.toolName;
  if (value.commandPreview !== undefined) metadata.commandPreview = value.commandPreview;
  return metadata;
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === "allow_once" || value === "allow_for_session" || value === "deny";
}

function optionalSessionErrorCode(value: unknown): value is SessionErrorCode | undefined {
  return value === undefined || isSessionErrorCode(value);
}

function optionalBridgeErrorCode(value: unknown): value is BridgeErrorCode | undefined {
  return value === undefined || isBridgeErrorCode(value);
}

function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return (
    value === "invalid_message" ||
    value === "internal_error" ||
    value === "payload_too_large" ||
    value === "codex_setup_failed"
  );
}

function isSessionErrorCode(value: unknown): value is SessionErrorCode {
  return (
    value === "session_not_started" ||
    value === "turn_in_flight" ||
    value === "no_in_flight_turn" ||
    value === "provider_error" ||
    value === "provider_start_failed" ||
    value === "provider_unavailable" ||
    value === "unsafe_provider_event" ||
    value === "permission_not_found" ||
    value === "permission_response_invalid" ||
    value === "unknown_error"
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

function isBoundedDisplayString(value: unknown, limit: number): value is string {
  return isNonEmptyString(value) && value.length <= limit;
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
