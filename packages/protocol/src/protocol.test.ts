import { describe, expect, it } from "vitest";
import {
  BRIDGE_PAYLOAD_TOO_LARGE_CODE,
  exceedsPayloadByteLimit,
  parseBridgeToExtension,
  parseExtensionToBridge,
  serializedJsonByteLength
} from "./index";

describe("extension-to-bridge protocol validation", () => {
  it("accepts valid session start and send messages", () => {
    expect(
      parseExtensionToBridge({
        type: "session.start",
        version: 1,
        clientSessionId: "page-1",
        providerId: "codex"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "What is this?"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects unknown commands and invalid payloads", () => {
    expect(parseExtensionToBridge({ type: "session.delete", version: 1 })).toEqual({
      ok: false,
      error: "Unknown command"
    });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: ""
      })
    ).toEqual({ ok: false, error: "prompt is required" });
  });

  it("rejects unknown extension commands with a parser-backed error", () => {
    expect(parseExtensionToBridge({ type: "session.delete", version: 1 })).toEqual({
      ok: false,
      error: "Unknown command"
    });
  });
});

describe("page context protocol validation", () => {
  it("accepts_readable_page_context_payload", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "readable",
          metadata: {
            url: "https://example.com/article",
            canonicalUrl: "https://example.com/canonical",
            title: "Article title",
            siteName: "Example",
            excerpt: "A useful excerpt.",
            byline: "Author Name",
            language: "en",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          text: "Readable article text.",
          textLength: "Readable article text.".length,
          extractionMethod: "readability"
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("accepts_metadata_only_page_context_payload", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "What is this?",
        pageContext: {
          kind: "metadata_only",
          metadata: {
            url: "https://example.com/article",
            title: "Article title",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          reason: "no_usable_text"
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("accepts_content_too_large_metadata_only_page_context_payload", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "What is this?",
        pageContext: {
          kind: "metadata_only",
          metadata: {
            url: "https://example.com/article",
            title: "Article title",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          reason: "content_too_large"
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects_metadata_only_page_context_with_unknown_reason", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "What is this?",
        pageContext: {
          kind: "metadata_only",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          reason: "unknown_reason"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_page_context_with_invalid_kind_or_missing_metadata", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "html",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          }
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "metadata_only",
          reason: "no_usable_text"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_readable_page_context_without_non_empty_text", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "readable",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          text: "   ",
          textLength: 3,
          extractionMethod: "readability"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_readable_page_context_when_text_length_does_not_match_text", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "readable",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          text: "Readable article text.",
          textLength: 999,
          extractionMethod: "readability"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_page_context_with_unknown_top_level_fields", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "metadata_only",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          reason: "no_usable_text",
          rawHtml: "<main>secret</main>"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_page_context_metadata_with_unknown_fields", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 1,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "metadata_only",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z",
            rawHtml: "<main>secret</main>"
          },
          reason: "no_usable_text"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });
});

describe("session.cancel protocol validation", () => {
  it("accepts session.cancel with a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.cancel",
        version: 1,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects session.cancel without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.cancel",
        version: 1
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("keeps rejecting unknown commands", () => {
    expect(
      parseExtensionToBridge({
        type: "session.abort",
        version: 1,
        clientSessionId: "page-1"
      })
    ).toEqual({ ok: false, error: "Unknown command" });
  });
});

describe("session lifecycle protocol validation", () => {
  it("accepts session.reset with a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.reset",
        version: 1,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("accepts session.close with a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.close",
        version: 1,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects session.reset without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.reset",
        version: 1
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("rejects session.close without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.close",
        version: 1
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("keeps rejecting unknown lifecycle commands", () => {
    expect(
      parseExtensionToBridge({
        type: "session.destroy",
        version: 1,
        clientSessionId: "page-1"
      })
    ).toEqual({ ok: false, error: "Unknown command" });
  });
});

describe("bridge-to-extension protocol validation", () => {
  it("accepts valid bridge messages and rejects malformed assistant deltas", () => {
    expect(parseBridgeToExtension({ type: "bridge.ready", version: 1 })).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "session.started",
        version: 1,
        clientSessionId: "page-1",
        bridgeSessionId: "bridge-1"
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 1,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta", text: "hello" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 1,
        clientSessionId: "page-1",
        event: { type: "assistant.done" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "session.error",
        version: 1,
        clientSessionId: "page-1",
        message: "failed",
        code: "provider-error"
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 1,
        message: "failed",
        code: "setup-error"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 1,
        clientSessionId: "page-1",
        event: { type: "assistant.cancelled" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 1,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta" }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects unknown bridge messages with a parser-backed error", () => {
    expect(parseBridgeToExtension({ type: "bridge.noop", version: 1 })).toEqual({
      ok: false,
      error: "Unknown message"
    });
  });

  it("accepts_payload_too_large_bridge_error_code", () => {
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 1,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      })
    ).toEqual({
      ok: true,
      value: {
        type: "bridge.error",
        version: 1,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      }
    });
  });
});

describe("protocol payload sizing", () => {
  it("measures_serialized_json_utf8_bytes", () => {
    expect(serializedJsonByteLength({ text: "abc" })).toEqual({ ok: true, byteLength: 14 });
    expect(serializedJsonByteLength({ text: "é" })).toEqual({ ok: true, byteLength: 13 });
    expect(serializedJsonByteLength(undefined)).toEqual({ ok: false, error: "not_json_serializable" });
  });

  it("checks_payload_limit_as_a_strict_upper_bound", () => {
    expect(exceedsPayloadByteLimit(10, 10)).toBe(false);
    expect(exceedsPayloadByteLimit(11, 10)).toBe(true);
  });
});
