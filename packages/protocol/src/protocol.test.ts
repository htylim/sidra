import { describe, expect, it } from "vitest";
import {
  BRIDGE_PAYLOAD_TOO_LARGE_CODE,
  exceedsPayloadByteLimit,
  parseAgentEvent,
  parseBridgeToExtension,
  parseExtensionToBridge,
  serializedJsonByteLength
} from "./index";

describe("extension-to-bridge protocol validation", () => {
  it("accepts valid session start and send messages", () => {
    expect(
      parseExtensionToBridge({
        type: "session.start",
        version: 2,
        clientSessionId: "page-1",
        providerId: "codex"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "What is this?"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects unknown commands and invalid payloads", () => {
    expect(parseExtensionToBridge({ type: "session.delete", version: 2 })).toEqual({
      ok: false,
      error: "Unknown command"
    });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: ""
      })
    ).toEqual({ ok: false, error: "prompt is required" });
  });

  it("rejects unknown extension commands with a parser-backed error", () => {
    expect(parseExtensionToBridge({ type: "session.delete", version: 2 })).toEqual({
      ok: false,
      error: "Unknown command"
    });
  });
});

describe("page context protocol validation", () => {
  it("accepts_full_dom_page_context_payload", () => {
    const html = "<html><body><main>Full DOM content</main></body></html>";

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "full_dom",
          metadata: {
            url: "https://example.com/article",
            title: "Article title",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          html,
          htmlLength: html.length
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects_full_dom_page_context_without_non_empty_html", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "full_dom",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          html: "   ",
          htmlLength: 3
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_full_dom_page_context_when_html_length_does_not_match_html", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "full_dom",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          html: "<html></html>",
          htmlLength: 999
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("rejects_full_dom_page_context_with_readable_text_fields", () => {
    const html = "<html><body>Full DOM content</body></html>";

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "Summarize this page",
        pageContext: {
          kind: "full_dom",
          metadata: {
            url: "https://example.com/article",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          html,
          htmlLength: html.length,
          text: "Readable text should not be mixed into full DOM.",
          textLength: "Readable text should not be mixed into full DOM.".length,
          extractionMethod: "readability"
        }
      })
    ).toEqual({ ok: false, error: "pageContext is invalid" });
  });

  it("accepts_full_dom_too_large_metadata_only_page_context_payload", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "What is this?",
        pageContext: {
          kind: "metadata_only",
          metadata: {
            url: "https://example.com/article",
            title: "Article title",
            capturedAt: "2026-05-10T12:00:00.000Z"
          },
          reason: "full_dom_too_large"
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("accepts_readable_page_context_payload", () => {
    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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
        version: 2,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects session.cancel without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.cancel",
        version: 2
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("keeps rejecting unknown commands", () => {
    expect(
      parseExtensionToBridge({
        type: "session.abort",
        version: 2,
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
        version: 2,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("accepts session.close with a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.close",
        version: 2,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects session.reset without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.reset",
        version: 2
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("rejects session.close without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.close",
        version: 2
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("keeps rejecting unknown lifecycle commands", () => {
    expect(
      parseExtensionToBridge({
        type: "session.destroy",
        version: 2,
        clientSessionId: "page-1"
      })
    ).toEqual({ ok: false, error: "Unknown command" });
  });
});

describe("bridge-to-extension protocol validation", () => {
  it("accepts valid bridge messages and rejects malformed assistant deltas", () => {
    expect(parseBridgeToExtension({ type: "bridge.ready", version: 2 })).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "session.started",
        version: 2,
        clientSessionId: "page-1",
        bridgeSessionId: "bridge-1"
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta", text: "hello" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.done" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "session.error",
        version: 2,
        clientSessionId: "page-1",
        message: "failed",
        code: "provider_error"
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 2,
        message: "failed",
        code: "setup-error"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.cancelled" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta" }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects unknown bridge messages with a parser-backed error", () => {
    expect(parseBridgeToExtension({ type: "bridge.noop", version: 2 })).toEqual({
      ok: false,
      error: "Unknown message"
    });
  });

  it("accepts_payload_too_large_bridge_error_code", () => {
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 2,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      })
    ).toEqual({
      ok: true,
      value: {
        type: "bridge.error",
        version: 2,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      }
    });
  });
});

describe("assistant activity protocol validation", () => {
  it("accepts tool activity with an allowlisted label", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "tool", phase: "started", label: "Tool started" } })).toEqual({
      ok: true,
      value: { type: "assistant.activity", activity: { kind: "tool", phase: "started", label: "Tool started" } }
    });
  });

  it("accepts progress activity with an allowlisted label", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "progress", label: "Reading" } })).toEqual({
      ok: true,
      value: { type: "assistant.activity", activity: { kind: "progress", label: "Reading" } }
    });
  });

  it("accepts error activity with an allowlisted label", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "error", label: "Activity error" } })).toEqual({
      ok: true,
      value: { type: "assistant.activity", activity: { kind: "error", label: "Activity error" } }
    });
  });

  it("accepts activity events through bridge message envelopes", () => {
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.activity", activity: { kind: "tool", phase: "started", label: "Tool started" } }
      })
    ).toEqual({
      ok: true,
      value: {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.activity", activity: { kind: "tool", phase: "started", label: "Tool started" } }
      }
    });
  });

  it("rejects activity events with unknown kinds", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "reasoning", label: "Working" } })).toEqual({
      ok: false,
      error: "event is invalid"
    });
  });

  it("rejects private reasoning or chain-of-thought activity fields", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "progress", label: "Working", reasoning: "private chain of thought" }
      })
    ).toEqual({ ok: false, error: "event is invalid" });

    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "progress", label: "Working", chainOfThought: "private" }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects free-form activity summary fields", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "progress", label: "Working", summary: "I searched your prompt and page." }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects activity events with extra fields", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "tool", phase: "finished", label: "Tool finished", durationMs: 12 }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects activity events with non-allowlisted labels", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "progress", label: "Thinking deeply" } })).toEqual({
      ok: false,
      error: "event is invalid"
    });
  });

  it("rejects error activity with non-allowlisted labels", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "error", label: "Detailed raw error" } })).toEqual({
      ok: false,
      error: "event is invalid"
    });
  });

  it("rejects invalid activity events through bridge message envelopes", () => {
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.activity", activity: { kind: "progress", label: "Thinking privately" } }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects_tool_activity_with_mismatched_phase_and_label", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "tool", phase: "started", label: "Tool finished" } })).toEqual({
      ok: false,
      error: "event is invalid"
    });
  });

  it("keeps rejecting malformed assistant text deltas", () => {
    expect(parseAgentEvent({ type: "assistant.text.delta" })).toEqual({ ok: false, error: "event is invalid" });
    expect(parseAgentEvent({ type: "assistant.text.delta", text: 42 })).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects extra fields on existing assistant event variants", () => {
    expect(parseAgentEvent({ type: "assistant.text.delta", text: "hello", reasoning: "private" })).toEqual({
      ok: false,
      error: "event is invalid"
    });
    expect(parseAgentEvent({ type: "assistant.done", text: "done" })).toEqual({ ok: false, error: "event is invalid" });
    expect(parseAgentEvent({ type: "assistant.cancelled", prompt: "secret" })).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects extra fields on bridge message envelopes", () => {
    expect(parseBridgeToExtension({ type: "bridge.ready", version: 2, extra: true })).toEqual({
      ok: false,
      error: "Message has invalid fields"
    });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.done" },
        extra: true
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });
  });

  it.each(["thought", "chainOfThought", "reasoning", "prompt", "pageContent", "stdout", "stderr"])(
    "rejects bridge message envelopes with private %s fields",
    (privateField) => {
      expect(
        parseBridgeToExtension({
          type: "agent.event",
          version: 2,
          clientSessionId: "page-1",
          event: { type: "assistant.done" },
          [privateField]: "secret"
        })
      ).toEqual({ ok: false, error: "Message has invalid fields" });
    }
  );

  it("rejects session error envelopes with private prompt fields", () => {
    expect(
      parseBridgeToExtension({
        type: "session.error",
        version: 2,
        clientSessionId: "page-1",
        message: "failed",
        prompt: "secret"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });
  });

  it("rejects_extra_fields_on_extension_request_envelopes", () => {
    expect(
      parseExtensionToBridge({
        type: "session.start",
        version: 2,
        clientSessionId: "page-1",
        providerId: "codex",
        extra: true
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });

    expect(parseExtensionToBridge({ type: "heartbeat", version: 2, clientSessionId: "page-1" })).toEqual({
      ok: false,
      error: "Message has invalid fields"
    });
  });

  it("rejects_extension_request_envelopes_with_private_reasoning_or_prompt_fields", () => {
    expect(
      parseExtensionToBridge({
        type: "session.cancel",
        version: 2,
        clientSessionId: "page-1",
        reasoning: "private"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });

    expect(parseExtensionToBridge({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex", prompt: "secret" })).toEqual({
      ok: false,
      error: "Message has invalid fields"
    });
  });

  it.each(["reasoning", "stdout", "stderr", "pageContent"])(
    "rejects session.send request envelopes with private %s fields",
    (privateField) => {
      expect(
        parseExtensionToBridge({
          type: "session.send",
          version: 2,
          clientSessionId: "page-1",
          prompt: "summarize",
          [privateField]: "secret"
        })
      ).toEqual({ ok: false, error: "Message has invalid fields" });
    }
  );

  it("accepts_known_session_error_codes", () => {
    for (const code of [
      "session_not_started",
      "turn_in_flight",
      "no_in_flight_turn",
      "provider_error",
      "provider_start_failed",
      "provider_unavailable",
      "unsafe_provider_event",
      "unknown_error"
    ]) {
      expect(parseBridgeToExtension({ type: "session.error", version: 2, clientSessionId: "page-1", message: "failed", code })).toMatchObject({
        ok: true
      });
    }
  });

  it("rejects_unknown_session_error_codes", () => {
    expect(
      parseBridgeToExtension({
        type: "session.error",
        version: 2,
        clientSessionId: "page-1",
        message: "failed",
        code: "provider-error"
      })
    ).toEqual({ ok: false, error: "code is invalid" });
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
