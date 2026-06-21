export const PROTOCOL_VERSION = 4;
export const BRIDGE_PAYLOAD_TOO_LARGE_CODE = "payload_too_large";
export const BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE = "Payload is too large.";
export const BRIDGE_HARD_PAYLOAD_BYTE_LIMIT = 1_000_000;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type SerializedJsonByteLengthResult =
  | { ok: true; byteLength: number }
  | { ok: false; error: "not_json_serializable" };

export type ProviderId = "codex";
export type SpeechModel = "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";
export type SpeechVoice =
  | "marin"
  | "cedar"
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer"
  | "verse";
export type SpeechAudioFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
export type SpeechSynthesisOptions = {
  model: SpeechModel;
  voice: SpeechVoice;
  format: SpeechAudioFormat;
  speed: number;
  instructions?: string;
};
export type SpeechCredentialSource = "keychain" | "environment";
export type SpeechCredentialStatus =
  | { configured: false }
  | { configured: true; source: SpeechCredentialSource; redactedKey: string };
export type SpeechErrorCode =
  | "openai_api_key_missing"
  | "openai_request_failed"
  | "speech_cancelled"
  | "speech_request_not_found"
  | "speech_invalid_request"
  | "unknown_error";
export type SpeechCredentialErrorCode =
  | "credential_store_failed"
  | "credential_test_failed"
  | "credential_missing"
  | "unknown_error";

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
  | "full_dom_too_large"
  | "selection_too_large";

export type PageContextRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageContextViewport = {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
};

export type PageContextCaptureProof = {
  requestId: string;
  tabId?: number;
  windowId?: number;
  documentUrl: string;
  viewport: PageContextViewport;
  screenshotWidth?: number;
  screenshotHeight?: number;
};

export type PageContextSelectionGeometry = {
  mode: "text_selection" | "area_snapshot";
  viewport: PageContextViewport;
  boundingRect: PageContextRect;
  textRects?: PageContextRect[];
  captureProof: PageContextCaptureProof;
};

export type PageContextImage = {
  mimeType: "image/png";
  dataBase64: string;
  byteLength: number;
  width: number;
  height: number;
};

export type PageContextBase =
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
    }
  | {
      kind: "selected_text";
      metadata: PageContextMetadata;
      text: string;
      textLength: number;
      selection: PageContextSelectionGeometry & { mode: "text_selection" };
    }
  | {
      kind: "area_snapshot";
      metadata: PageContextMetadata;
      image: PageContextImage;
      selection: PageContextSelectionGeometry & { mode: "area_snapshot" };
    };

export type PageContextBundleItem = {
  id: string;
  label: string;
  trust: "untrusted";
  source: "selected_text" | "area_snapshot" | "page_capture";
  context: PageContextBase;
};

export type PageContext =
  | PageContextBase
  | {
      kind: "context_bundle";
      trust: "untrusted";
      metadata: PageContextMetadata;
      createdAt: string;
      items: PageContextBundleItem[];
    };

export type ExtensionToBridge =
  | {
      type: "session.start";
      version: ProtocolVersion;
      clientSessionId: string;
      providerId: ProviderId;
    }
  | {
      type: "session.send";
      version: ProtocolVersion;
      clientSessionId: string;
      prompt: string;
      pageContext?: PageContext;
    }
  | { type: "session.cancel"; version: ProtocolVersion; clientSessionId: string }
  | { type: "session.reset"; version: ProtocolVersion; clientSessionId: string }
  | { type: "session.close"; version: ProtocolVersion; clientSessionId: string }
  | {
      type: "permission.respond";
      version: ProtocolVersion;
      clientSessionId: string;
      requestId: string;
      decision: PermissionDecision;
    }
  | {
      type: "speech.synthesize";
      version: ProtocolVersion;
      requestId: string;
      text: string;
      options: SpeechSynthesisOptions;
    }
  | { type: "speech.cancel"; version: ProtocolVersion; requestId: string }
  | { type: "speech.credentials.status"; version: ProtocolVersion }
  | { type: "speech.credentials.save"; version: ProtocolVersion; apiKey: string }
  | { type: "speech.credentials.test"; version: ProtocolVersion; apiKey?: string }
  | { type: "speech.credentials.remove"; version: ProtocolVersion }
  | { type: "heartbeat"; version: ProtocolVersion };

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

export type BridgeErrorCode =
  | "invalid_message"
  | "internal_error"
  | "payload_too_large"
  | "codex_setup_failed"
  | "heartbeat_timeout";

export type BridgeToExtension =
  | {
      type: "session.started";
      version: ProtocolVersion;
      clientSessionId: string;
      bridgeSessionId: string;
    }
  | {
      type: "agent.event";
      version: ProtocolVersion;
      clientSessionId: string;
      event: AgentEvent;
    }
  | {
      type: "permission.request";
      version: ProtocolVersion;
      clientSessionId: string;
      request: PermissionRequest;
    }
  | { type: "session.error"; version: ProtocolVersion; clientSessionId: string; message: string; code?: SessionErrorCode }
  | { type: "bridge.ready"; version: ProtocolVersion }
  | { type: "bridge.error"; version: ProtocolVersion; message: string; code?: BridgeErrorCode }
  | { type: "speech.started"; version: ProtocolVersion; requestId: string; mimeType: string }
  | { type: "speech.chunk"; version: ProtocolVersion; requestId: string; sequence: number; audioBase64: string }
  | { type: "speech.done"; version: ProtocolVersion; requestId: string }
  | { type: "speech.error"; version: ProtocolVersion; requestId: string; message: string; code?: SpeechErrorCode }
  | ({ type: "speech.credentials.status"; version: ProtocolVersion } & SpeechCredentialStatus)
  | ({ type: "speech.credentials.saved"; version: ProtocolVersion } & Extract<SpeechCredentialStatus, { configured: true }>)
  | { type: "speech.credentials.tested"; version: ProtocolVersion; ok: true }
  | ({ type: "speech.credentials.removed"; version: ProtocolVersion } & SpeechCredentialStatus)
  | { type: "speech.credentials.error"; version: ProtocolVersion; message: string; code?: SpeechCredentialErrorCode };

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
    case "speech.synthesize":
      if (!hasOnlyKeys(input, ["type", "version", "requestId", "text", "options"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      if (!isBoundedDisplayString(input.text, SPEECH_TEXT_CHARACTER_LIMIT)) return invalid("text is required");
      {
        const options = parseSpeechSynthesisOptions(input.options);
        if (!options) return invalid("speech options are invalid");
        return {
          ok: true,
          value: {
            type: "speech.synthesize",
            version: PROTOCOL_VERSION,
            requestId: input.requestId,
            text: input.text,
            options
          }
        };
      }
    case "speech.cancel":
      if (!hasOnlyKeys(input, ["type", "version", "requestId"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      return {
        ok: true,
        value: {
          type: "speech.cancel",
          version: PROTOCOL_VERSION,
          requestId: input.requestId
        }
      };
    case "speech.credentials.status":
    case "speech.credentials.remove":
      if (!hasOnlyKeys(input, ["type", "version"])) return invalid("Message has invalid fields");
      return { ok: true, value: { type: input.type, version: PROTOCOL_VERSION } };
    case "speech.credentials.save":
      if (!hasOnlyKeys(input, ["type", "version", "apiKey"])) return invalid("Message has invalid fields");
      if (!isNonEmptyString(input.apiKey)) return invalid("apiKey is required");
      return {
        ok: true,
        value: { type: "speech.credentials.save", version: PROTOCOL_VERSION, apiKey: input.apiKey }
      };
    case "speech.credentials.test":
      if (!hasOnlyKeys(input, ["type", "version", "apiKey"])) return invalid("Message has invalid fields");
      if (input.apiKey !== undefined && !isNonEmptyString(input.apiKey)) return invalid("apiKey is required");
      return {
        ok: true,
        value:
          input.apiKey === undefined
            ? { type: "speech.credentials.test", version: PROTOCOL_VERSION }
            : { type: "speech.credentials.test", version: PROTOCOL_VERSION, apiKey: input.apiKey }
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
    case "speech.started":
      if (!hasOnlyKeys(input, ["type", "version", "requestId", "mimeType"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      if (!isNonEmptyString(input.mimeType)) return invalid("mimeType is required");
      return {
        ok: true,
        value: { type: "speech.started", version: PROTOCOL_VERSION, requestId: input.requestId, mimeType: input.mimeType }
      };
    case "speech.chunk":
      if (!hasOnlyKeys(input, ["type", "version", "requestId", "sequence", "audioBase64"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      if (!isNonNegativeInteger(input.sequence)) return invalid("sequence is invalid");
      if (!isNonEmptyString(input.audioBase64)) return invalid("audioBase64 is required");
      return {
        ok: true,
        value: {
          type: "speech.chunk",
          version: PROTOCOL_VERSION,
          requestId: input.requestId,
          sequence: input.sequence,
          audioBase64: input.audioBase64
        }
      };
    case "speech.done":
      if (!hasOnlyKeys(input, ["type", "version", "requestId"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      return { ok: true, value: { type: "speech.done", version: PROTOCOL_VERSION, requestId: input.requestId } };
    case "speech.error":
      if (!hasOnlyKeys(input, ["type", "version", "requestId", "message", "code"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.requestId)) return invalid("requestId is required");
      if (!isNonEmptyString(input.message)) return invalid("message is required");
      if (!optionalSpeechErrorCode(input.code)) return invalid("code is invalid");
      {
        const value: BridgeToExtension = {
          type: "speech.error",
          version: PROTOCOL_VERSION,
          requestId: input.requestId,
          message: input.message
        };
        if (input.code !== undefined) value.code = input.code;
        return { ok: true, value };
      }
    case "speech.credentials.status":
      if (!hasOnlyKeys(input, ["type", "version", "configured", "source", "redactedKey"])) {
        return invalid("Message has invalid fields");
      }
      {
        const status = parseSpeechCredentialStatus(input);
        if (!status) return invalid("credential status is invalid");
        return { ok: true, value: { type: "speech.credentials.status", version: PROTOCOL_VERSION, ...status } };
      }
    case "speech.credentials.saved":
      if (!hasOnlyKeys(input, ["type", "version", "configured", "source", "redactedKey"])) {
        return invalid("Message has invalid fields");
      }
      {
        const status = parseSpeechCredentialStatus(input);
        if (!status || !status.configured) return invalid("credential status is invalid");
        return { ok: true, value: { type: "speech.credentials.saved", version: PROTOCOL_VERSION, ...status } };
      }
    case "speech.credentials.tested":
      if (!hasOnlyKeys(input, ["type", "version", "ok"])) return invalid("Message has invalid fields");
      if (input.ok !== true) return invalid("ok is invalid");
      return { ok: true, value: { type: "speech.credentials.tested", version: PROTOCOL_VERSION, ok: true } };
    case "speech.credentials.removed":
      if (!hasOnlyKeys(input, ["type", "version", "configured", "source", "redactedKey"])) {
        return invalid("Message has invalid fields");
      }
      {
        const status = parseSpeechCredentialStatus(input);
        if (!status) return invalid("credential status is invalid");
        return { ok: true, value: { type: "speech.credentials.removed", version: PROTOCOL_VERSION, ...status } };
      }
    case "speech.credentials.error":
      if (!hasOnlyKeys(input, ["type", "version", "message", "code"])) {
        return invalid("Message has invalid fields");
      }
      if (!isNonEmptyString(input.message)) return invalid("message is required");
      if (!optionalSpeechCredentialErrorCode(input.code)) return invalid("code is invalid");
      {
        const value: BridgeToExtension = {
          type: "speech.credentials.error",
          version: PROTOCOL_VERSION,
          message: input.message
        };
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

  if (value.kind === "context_bundle") {
    return parseContextBundle(value, metadata);
  }

  return parsePageContextBase(value, metadata);
}

function parsePageContextBase(value: Record<string, unknown>, metadata: PageContextMetadata): PageContextBase | null {
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
    case "selected_text":
      if (!hasOnlyKeys(value, ["kind", "metadata", "text", "textLength", "selection"])) return null;
      if (!isNonEmptyString(value.text)) return null;
      if (typeof value.textLength !== "number" || !Number.isInteger(value.textLength)) return null;
      if (value.textLength !== value.text.length) return null;
      {
        const selection = parseSelectionGeometry(value.selection, "text_selection");
        if (!selection) return null;
        return {
          kind: "selected_text",
          metadata,
          text: value.text,
          textLength: value.textLength,
          selection
        };
      }
    case "area_snapshot":
      if (!hasOnlyKeys(value, ["kind", "metadata", "image", "selection"])) return null;
      {
        const image = parsePageContextImage(value.image);
        const selection = parseSelectionGeometry(value.selection, "area_snapshot");
        if (!image || !selection) return null;
        return {
          kind: "area_snapshot",
          metadata,
          image,
          selection
        };
      }
    default:
      return null;
  }
}

function isMetadataOnlyPageContextReason(value: unknown): value is MetadataOnlyPageContextReason {
  return (
    value === "no_usable_text" ||
    value === "content_too_large" ||
    value === "full_dom_too_large" ||
    value === "selection_too_large"
  );
}

function parseContextBundle(value: Record<string, unknown>, metadata: PageContextMetadata): PageContext | null {
  if (!hasOnlyKeys(value, ["kind", "trust", "metadata", "createdAt", "items"])) return null;
  if (value.trust !== "untrusted") return null;
  if (!isNonEmptyString(value.createdAt)) return null;
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > 12) return null;

  const ids = new Set<string>();
  const items: PageContextBundleItem[] = [];
  for (const item of value.items) {
    const parsedItem = parseContextBundleItem(item);
    if (!parsedItem || ids.has(parsedItem.id)) return null;
    ids.add(parsedItem.id);
    items.push(parsedItem);
  }

  return {
    kind: "context_bundle",
    trust: "untrusted",
    metadata,
    createdAt: value.createdAt,
    items
  };
}

function parseContextBundleItem(value: unknown): PageContextBundleItem | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["id", "label", "trust", "source", "context"])) return null;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.label)) return null;
  if (value.trust !== "untrusted") return null;
  if (!isPageContextBundleItemSource(value.source)) return null;
  if (!isRecord(value.context) || !isRecord(value.context.metadata)) return null;

  const itemMetadata = parsePageContextMetadata(value.context.metadata);
  if (!itemMetadata) return null;
  const context = parsePageContextBase(value.context, itemMetadata);
  if (!context || !bundleSourceMatchesContext(value.source, context)) return null;

  return {
    id: value.id,
    label: value.label,
    trust: "untrusted",
    source: value.source,
    context
  };
}

function isPageContextBundleItemSource(value: unknown): value is PageContextBundleItem["source"] {
  return value === "selected_text" || value === "area_snapshot" || value === "page_capture";
}

function bundleSourceMatchesContext(source: PageContextBundleItem["source"], context: PageContextBase): boolean {
  if (source === "selected_text") {
    return context.kind === "selected_text" || (context.kind === "metadata_only" && context.reason === "selection_too_large");
  }
  if (source === "area_snapshot") return context.kind === "area_snapshot";
  return (
    context.kind === "readable" ||
    context.kind === "full_dom" ||
    (context.kind === "metadata_only" && context.reason !== "selection_too_large")
  );
}

function parseSelectionGeometry<Mode extends "text_selection" | "area_snapshot">(
  value: unknown,
  expectedMode: Mode
): (PageContextSelectionGeometry & { mode: Mode }) | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["mode", "viewport", "boundingRect", "textRects", "captureProof"])) return null;
  if (value.mode !== expectedMode) return null;
  const viewport = parseViewport(value.viewport);
  const boundingRect = parseRect(value.boundingRect);
  const captureProof = parseCaptureProof(value.captureProof);
  if (!viewport || !boundingRect || !captureProof) return null;
  if (!sameViewport(viewport, captureProof.viewport)) return null;

  const selection: PageContextSelectionGeometry & { mode: Mode } = {
    mode: expectedMode,
    viewport,
    boundingRect,
    captureProof
  };

  if (value.textRects !== undefined) {
    if (!Array.isArray(value.textRects)) return null;
    const textRects: PageContextRect[] = [];
    for (const rect of value.textRects) {
      const parsedRect = parseRect(rect);
      if (!parsedRect) return null;
      textRects.push(parsedRect);
    }
    selection.textRects = textRects;
  }

  return selection;
}

function parseCaptureProof(value: unknown): PageContextCaptureProof | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["requestId", "tabId", "windowId", "documentUrl", "viewport", "screenshotWidth", "screenshotHeight"])) {
    return null;
  }
  if (!isNonEmptyString(value.requestId) || !isNonEmptyString(value.documentUrl)) return null;
  if (!optionalNonNegativeInteger(value.tabId) || !optionalNonNegativeInteger(value.windowId)) return null;
  if (!optionalPositiveInteger(value.screenshotWidth) || !optionalPositiveInteger(value.screenshotHeight)) return null;
  const viewport = parseViewport(value.viewport);
  if (!viewport) return null;

  const proof: PageContextCaptureProof = {
    requestId: value.requestId,
    documentUrl: value.documentUrl,
    viewport
  };
  if (value.tabId !== undefined) proof.tabId = value.tabId;
  if (value.windowId !== undefined) proof.windowId = value.windowId;
  if (value.screenshotWidth !== undefined) proof.screenshotWidth = value.screenshotWidth;
  if (value.screenshotHeight !== undefined) proof.screenshotHeight = value.screenshotHeight;
  return proof;
}

function parseViewport(value: unknown): PageContextViewport | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["width", "height", "devicePixelRatio", "scrollX", "scrollY"])) return null;
  if (!isPositiveFiniteNumber(value.width) || !isPositiveFiniteNumber(value.height)) return null;
  if (!isPositiveFiniteNumber(value.devicePixelRatio)) return null;
  if (!isFiniteNumber(value.scrollX) || !isFiniteNumber(value.scrollY)) return null;
  return {
    width: value.width,
    height: value.height,
    devicePixelRatio: value.devicePixelRatio,
    scrollX: value.scrollX,
    scrollY: value.scrollY
  };
}

function parseRect(value: unknown): PageContextRect | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["x", "y", "width", "height"])) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!isPositiveFiniteNumber(value.width) || !isPositiveFiniteNumber(value.height)) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function parsePageContextImage(value: unknown): PageContextImage | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["mimeType", "dataBase64", "byteLength", "width", "height"])) return null;
  if (value.mimeType !== "image/png") return null;
  if (!isNonEmptyString(value.dataBase64)) return null;
  if (!isPositiveInteger(value.byteLength) || !isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return null;
  const decodedBytes = decodeBase64Bytes(value.dataBase64);
  if (decodedBytes === null || decodedBytes.byteLength !== value.byteLength) return null;
  if (!isPngWithDimensions(decodedBytes, value.width, value.height)) return null;
  return {
    mimeType: "image/png",
    dataBase64: value.dataBase64,
    byteLength: value.byteLength,
    width: value.width,
    height: value.height
  };
}

function sameViewport(left: PageContextViewport, right: PageContextViewport): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.devicePixelRatio === right.devicePixelRatio &&
    left.scrollX === right.scrollX &&
    left.scrollY === right.scrollY
  );
}

function decodeBase64Bytes(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function isPngWithDimensions(bytes: Uint8Array, width: number, height: number): boolean {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33) return false;
  for (let index = 0; index < pngSignature.length; index += 1) {
    if (bytes[index] !== pngSignature[index]) return false;
  }

  const ihdrLength = readUint32(bytes, 8);
  const ihdrType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdrLength !== 13 || ihdrType !== "IHDR") return false;

  return readUint32(bytes, 16) === width && readUint32(bytes, 20) === height;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
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
const SPEECH_TEXT_CHARACTER_LIMIT = 50_000;
const SPEECH_INSTRUCTIONS_CHARACTER_LIMIT = 2_000;
const SPEECH_MIN_SPEED = 0.25;
const SPEECH_MAX_SPEED = 4;
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

function parseSpeechSynthesisOptions(value: unknown): SpeechSynthesisOptions | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["model", "voice", "format", "speed", "instructions"])) return null;
  if (!isSpeechModel(value.model)) return null;
  if (!isSpeechVoice(value.voice)) return null;
  if (!isSpeechAudioFormat(value.format)) return null;
  if (typeof value.speed !== "number" || !Number.isFinite(value.speed)) return null;
  if (value.speed < SPEECH_MIN_SPEED || value.speed > SPEECH_MAX_SPEED) return null;
  if (
    value.instructions !== undefined &&
    (typeof value.instructions !== "string" || value.instructions.length > SPEECH_INSTRUCTIONS_CHARACTER_LIMIT)
  ) {
    return null;
  }

  const options: SpeechSynthesisOptions = {
    model: value.model,
    voice: value.voice,
    format: value.format,
    speed: value.speed
  };
  if (typeof value.instructions === "string" && value.instructions.trim().length > 0) {
    options.instructions = value.instructions;
  }
  return options;
}

function parseSpeechCredentialStatus(value: Record<string, unknown>): SpeechCredentialStatus | null {
  if (value.configured === false) {
    if (value.source !== undefined || value.redactedKey !== undefined) return null;
    return { configured: false };
  }
  if (value.configured !== true) return null;
  if (!isSpeechCredentialSource(value.source)) return null;
  if (!isNonEmptyString(value.redactedKey)) return null;
  return { configured: true, source: value.source, redactedKey: value.redactedKey };
}

function isSpeechModel(value: unknown): value is SpeechModel {
  return value === "gpt-4o-mini-tts" || value === "tts-1" || value === "tts-1-hd";
}

function isSpeechVoice(value: unknown): value is SpeechVoice {
  return (
    value === "marin" ||
    value === "cedar" ||
    value === "alloy" ||
    value === "ash" ||
    value === "ballad" ||
    value === "coral" ||
    value === "echo" ||
    value === "fable" ||
    value === "nova" ||
    value === "onyx" ||
    value === "sage" ||
    value === "shimmer" ||
    value === "verse"
  );
}

function isSpeechAudioFormat(value: unknown): value is SpeechAudioFormat {
  return value === "mp3" || value === "opus" || value === "aac" || value === "flac" || value === "wav" || value === "pcm";
}

function isSpeechCredentialSource(value: unknown): value is SpeechCredentialSource {
  return value === "keychain" || value === "environment";
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
    value === "codex_setup_failed" ||
    value === "heartbeat_timeout"
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

function optionalSpeechErrorCode(value: unknown): value is SpeechErrorCode | undefined {
  return value === undefined || isSpeechErrorCode(value);
}

function isSpeechErrorCode(value: unknown): value is SpeechErrorCode {
  return (
    value === "openai_api_key_missing" ||
    value === "openai_request_failed" ||
    value === "speech_cancelled" ||
    value === "speech_request_not_found" ||
    value === "speech_invalid_request" ||
    value === "unknown_error"
  );
}

function optionalSpeechCredentialErrorCode(value: unknown): value is SpeechCredentialErrorCode | undefined {
  return value === undefined || isSpeechCredentialErrorCode(value);
}

function isSpeechCredentialErrorCode(value: unknown): value is SpeechCredentialErrorCode {
  return (
    value === "credential_store_failed" ||
    value === "credential_test_failed" ||
    value === "credential_missing" ||
    value === "unknown_error"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function optionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || isPositiveInteger(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
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
