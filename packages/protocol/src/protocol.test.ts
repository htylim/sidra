import { describe, expect, it } from "vitest";
import {
  BRIDGE_PAYLOAD_TOO_LARGE_CODE,
  PROTOCOL_VERSION,
  exceedsPayloadByteLimit,
  parseAgentEvent,
  parseBridgeToExtension,
  parseExtensionToBridge,
  serializedJsonByteLength
} from "./index";

describe("speech protocol validation", () => {
  it("protocol_accepts_speech_synthesize_and_cancel", () => {
    expect(PROTOCOL_VERSION).toBe(3);

    expect(
      parseExtensionToBridge({
        type: "speech.synthesize",
        version: 3,
        requestId: "speech-1",
        text: "Read this bubble aloud.",
        options: {
          model: "gpt-4o-mini-tts",
          voice: "marin",
          format: "mp3",
          speed: 1,
          instructions: "Speak clearly."
        }
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "speech.cancel",
        version: 3,
        requestId: "speech-1"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "speech.synthesize",
        version: 3,
        requestId: "speech-2",
        text: "Read this bubble aloud.",
        options: {
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          format: "mp3",
          speed: 1,
          instructions: ""
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("protocol_accepts_speech_credential_messages", () => {
    for (const message of [
      { type: "speech.credentials.status", version: 3 },
      { type: "speech.credentials.save", version: 3, apiKey: "sk-test" },
      { type: "speech.credentials.test", version: 3 },
      { type: "speech.credentials.test", version: 3, apiKey: "sk-unsaved-test" },
      { type: "speech.credentials.remove", version: 3 }
    ]) {
      expect(parseExtensionToBridge(message)).toMatchObject({ ok: true });
    }
  });

  it("protocol_rejects_invalid_speech_messages", () => {
    expect(
      parseExtensionToBridge({
        type: "speech.synthesize",
        version: 3,
        requestId: "speech-1",
        text: "",
        options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
      })
    ).toEqual({ ok: false, error: "text is required" });

    expect(
      parseExtensionToBridge({
        type: "speech.synthesize",
        version: 3,
        requestId: "speech-1",
        text: "Read this.",
        options: { model: "gpt-4o-mini-tts", voice: "made-up", format: "mp3", speed: 1 }
      })
    ).toEqual({ ok: false, error: "speech options are invalid" });

    expect(
      parseExtensionToBridge({
        type: "speech.synthesize",
        version: 3,
        requestId: "speech-1",
        text: "Read this.",
        options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 5 }
      })
    ).toEqual({ ok: false, error: "speech options are invalid" });

    expect(
      parseExtensionToBridge({
        type: "speech.synthesize",
        version: 3,
        requestId: "speech-1",
        text: "Read this.",
        options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 },
        apiKey: "sk-should-not-cross"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });
  });

  it("protocol_accepts_speech_bridge_events", () => {
    for (const message of [
      { type: "speech.started", version: 3, requestId: "speech-1", mimeType: "audio/mpeg" },
      { type: "speech.chunk", version: 3, requestId: "speech-1", sequence: 0, audioBase64: "AA==" },
      { type: "speech.done", version: 3, requestId: "speech-1" },
      {
        type: "speech.error",
        version: 3,
        requestId: "speech-1",
        message: "OpenAI API key is missing.",
        code: "openai_api_key_missing"
      },
      {
        type: "speech.credentials.status",
        version: 3,
        configured: true,
        source: "keychain",
        redactedKey: "sk-...abcd"
      },
      { type: "speech.credentials.saved", version: 3, configured: true, source: "keychain", redactedKey: "sk-...abcd" },
      { type: "speech.credentials.tested", version: 3, ok: true },
      { type: "speech.credentials.removed", version: 3, configured: false },
      {
        type: "speech.credentials.removed",
        version: 3,
        configured: true,
        source: "environment",
        redactedKey: "sk-...env1"
      },
      { type: "speech.credentials.error", version: 3, message: "Credential check failed.", code: "credential_test_failed" }
    ]) {
      expect(parseBridgeToExtension(message)).toMatchObject({ ok: true });
    }
  });

  it("protocol_never_accepts_raw_key_in_bridge_responses", () => {
    expect(
      parseBridgeToExtension({
        type: "speech.credentials.status",
        version: 3,
        configured: true,
        source: "keychain",
        redactedKey: "sk-...abcd",
        apiKey: "sk-secret"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });

    expect(
      parseBridgeToExtension({
        type: "speech.credentials.saved",
        version: 3,
        configured: true,
        source: "keychain",
        redactedKey: "sk-...abcd",
        apiKey: "sk-secret"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });
  });
});

describe("extension-to-bridge protocol validation", () => {
  it("accepts valid session start and send messages", () => {
    expect(
      parseExtensionToBridge({
        type: "session.start",
        version: 3,
        clientSessionId: "page-1",
        providerId: "codex"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 3,
        clientSessionId: "page-1",
        prompt: "What is this?"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects unknown commands and invalid payloads", () => {
    expect(parseExtensionToBridge({ type: "session.delete", version: 3 })).toEqual({
      ok: false,
      error: "Unknown command"
    });

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 3,
        clientSessionId: "page-1",
        prompt: ""
      })
    ).toEqual({ ok: false, error: "prompt is required" });
  });

  it("rejects unknown extension commands with a parser-backed error", () => {
    expect(parseExtensionToBridge({ type: "session.delete", version: 3 })).toEqual({
      ok: false,
      error: "Unknown command"
    });
  });

  it("accepts_permission_respond_messages", () => {
    expect(
      parseExtensionToBridge({
        type: "permission.respond",
        version: 3,
        clientSessionId: "page-1",
        requestId: "permission-1",
        decision: "allow_once"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "permission.respond",
        version: 3,
        clientSessionId: "page-1",
        requestId: "permission-1",
        decision: "allow_for_session"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseExtensionToBridge({
        type: "permission.respond",
        version: 3,
        clientSessionId: "page-1",
        requestId: "permission-1",
        decision: "deny"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects_permission_respond_without_request_id", () => {
    expect(
      parseExtensionToBridge({
        type: "permission.respond",
        version: 3,
        clientSessionId: "page-1",
        decision: "allow_once"
      })
    ).toEqual({ ok: false, error: "requestId is required" });
  });

  it("rejects_permission_respond_with_unknown_decision", () => {
    expect(
      parseExtensionToBridge({
        type: "permission.respond",
        version: 3,
        clientSessionId: "page-1",
        requestId: "permission-1",
        decision: "allow_forever"
      })
    ).toEqual({ ok: false, error: "decision is invalid" });
  });

  it("rejects_permission_respond_with_private_or_unknown_fields", () => {
    expect(
      parseExtensionToBridge({
        type: "permission.respond",
        version: 3,
        clientSessionId: "page-1",
        requestId: "permission-1",
        decision: "allow_once",
        prompt: "private"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });
  });
});

describe("bridge-to-extension permission protocol validation", () => {
  it("accepts_permission_request_message", () => {
    expect(
      parseBridgeToExtension({
        type: "permission.request",
        version: 3,
        clientSessionId: "page-1",
        request: {
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command",
          description: "Allow the provider to inspect files.",
          metadata: {
            toolName: "shell",
            commandPreview: "ls"
          }
        }
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects_permission_request_without_client_session_id", () => {
    expect(
      parseBridgeToExtension({
        type: "permission.request",
        version: 3,
        request: {
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command"
        }
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("rejects_permission_request_without_request_id", () => {
    expect(
      parseBridgeToExtension({
        type: "permission.request",
        version: 3,
        clientSessionId: "page-1",
        request: {
          permissionKey: "shell:ls",
          title: "Run command"
        }
      })
    ).toEqual({ ok: false, error: "request is invalid" });
  });

  it("rejects_permission_request_without_permission_key", () => {
    expect(
      parseBridgeToExtension({
        type: "permission.request",
        version: 3,
        clientSessionId: "page-1",
        request: {
          requestId: "permission-1",
          title: "Run command"
        }
      })
    ).toEqual({ ok: false, error: "request is invalid" });
  });

  it("rejects_permission_request_with_private_or_unknown_fields", () => {
    for (const field of ["prompt", "pageContent", "stdout", "stderr", "chainOfThought", "rawInput"]) {
      expect(
        parseBridgeToExtension({
          type: "permission.request",
          version: 3,
          clientSessionId: "page-1",
          request: {
            requestId: "permission-1",
            permissionKey: "shell:ls",
            title: "Run command",
            [field]: "private"
          }
        })
      ).toEqual({ ok: false, error: "request is invalid" });
    }

    expect(
      parseBridgeToExtension({
        type: "permission.request",
        version: 3,
        clientSessionId: "page-1",
        request: {
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command",
          metadata: {
            toolName: "shell",
            rawInput: "private"
          }
        }
      })
    ).toEqual({ ok: false, error: "request is invalid" });
  });
});

describe("page context protocol validation", () => {
  it("accepts_full_dom_page_context_payload", () => {
    const html = "<html><body><main>Full DOM content</main></body></html>";

    expect(
      parseExtensionToBridge({
        type: "session.send",
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects session.cancel without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.cancel",
        version: 3
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("keeps rejecting unknown commands", () => {
    expect(
      parseExtensionToBridge({
        type: "session.abort",
        version: 3,
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
        version: 3,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("accepts session.close with a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.close",
        version: 3,
        clientSessionId: "page-1"
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects session.reset without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.reset",
        version: 3
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("rejects session.close without a clientSessionId", () => {
    expect(
      parseExtensionToBridge({
        type: "session.close",
        version: 3
      })
    ).toEqual({ ok: false, error: "clientSessionId is required" });
  });

  it("keeps rejecting unknown lifecycle commands", () => {
    expect(
      parseExtensionToBridge({
        type: "session.destroy",
        version: 3,
        clientSessionId: "page-1"
      })
    ).toEqual({ ok: false, error: "Unknown command" });
  });
});

describe("bridge-to-extension protocol validation", () => {
  it("accepts valid bridge messages and rejects malformed assistant deltas", () => {
    expect(parseBridgeToExtension({ type: "bridge.ready", version: 3 })).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "session.started",
        version: 3,
        clientSessionId: "page-1",
        bridgeSessionId: "bridge-1"
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta", text: "hello" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.done" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "session.error",
        version: 3,
        clientSessionId: "page-1",
        message: "failed",
        code: "provider_error"
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 3,
        message: "failed",
        code: "internal_error"
      })
    ).toMatchObject({ ok: true });

    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.cancelled" }
      })
    ).toMatchObject({ ok: true });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta" }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects unknown bridge messages with a parser-backed error", () => {
    expect(parseBridgeToExtension({ type: "bridge.noop", version: 3 })).toEqual({
      ok: false,
      error: "Unknown message"
    });
  });

  it("accepts_payload_too_large_bridge_error_code", () => {
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 3,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      })
    ).toEqual({
      ok: true,
      value: {
        type: "bridge.error",
        version: 3,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      }
    });
  });

  it("accepts_known_bridge_error_codes", () => {
    for (const code of ["invalid_message", "internal_error", "payload_too_large"]) {
      expect(parseBridgeToExtension({ type: "bridge.error", version: 3, message: "failed", code })).toMatchObject({
        ok: true
      });
    }
  });

  it("rejects_unknown_bridge_error_codes", () => {
    expect(parseBridgeToExtension({ type: "bridge.error", version: 3, message: "failed", code: "setup-error" })).toEqual({
      ok: false,
      error: "code is invalid"
    });
  });

  it("accepts_codex_setup_failed_bridge_error_code", () => {
    expect(
      parseBridgeToExtension({
        type: "bridge.error",
        version: 3,
        message: "Codex setup failed.",
        code: "codex_setup_failed"
      })
    ).toMatchObject({ ok: true });
  });
});

describe("assistant activity protocol validation", () => {
  it("accepts_reasoning_summary_delta_activity", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Checked the code." } })).toEqual({
      ok: true,
      value: { type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Checked the code." } }
    });
  });

  it("accepts_tool_activity_with_bounded_details", () => {
    const activity = {
      kind: "tool",
      itemId: "item-1",
      toolKind: "command",
      phase: "started",
      title: "Run command",
      details: [{ label: "Command", value: "pnpm test" }]
    };

    expect(parseAgentEvent({ type: "assistant.activity", activity })).toEqual({
      ok: true,
      value: { type: "assistant.activity", activity }
    });
  });

  it("accepts_command_output_delta_activity", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "command_output_delta", itemId: "item-1", stream: "stdout", text: "test output" }
      })
    ).toEqual({
      ok: true,
      value: {
        type: "assistant.activity",
        activity: { kind: "command_output_delta", itemId: "item-1", stream: "stdout", text: "test output" }
      }
    });
  });

  it("rejects_raw_reasoning_text_activity", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "reasoning_text_delta", text: "private" } })).toEqual({
      ok: false,
      error: "event is invalid"
    });
  });

  it("rejects_activity_details_with_private_reasoning_fields", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "reasoning", value: "private" }]
        }
      })
    ).toEqual({ ok: false, error: "event is invalid" });

    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "chainOfThought", value: "private" }]
        }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects_activity_details_with_prompt_or_page_content_fields", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "prompt", value: "private prompt" }]
        }
      })
    ).toEqual({ ok: false, error: "event is invalid" });

    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "pageContent", value: "private page" }]
        }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects_activity_detail_values_over_the_length_limit", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "Command", value: "x".repeat(2_001) }]
        }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("accepts_new_activity_shapes_through_bridge_message_envelopes", () => {
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Checked the code." } }
      })
    ).toEqual({
      ok: true,
      value: {
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Checked the code." } }
      }
    });
  });

  it("rejects activity events with unknown kinds", () => {
    expect(parseAgentEvent({ type: "assistant.activity", activity: { kind: "reasoning", label: "Working" } })).toEqual({
      ok: false,
      error: "event is invalid"
    });
  });

  it("rejects activity events with extra fields", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "reasoning_summary_delta", text: "Checked the code.", rawText: "private" }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects invalid activity events through bridge message envelopes", () => {
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
        clientSessionId: "page-1",
        event: { type: "assistant.activity", activity: { kind: "progress", label: "Thinking privately" } }
      })
    ).toEqual({ ok: false, error: "event is invalid" });
  });

  it("rejects_tool_activity_with_invalid_phase", () => {
    expect(
      parseAgentEvent({
        type: "assistant.activity",
        activity: { kind: "tool", itemId: "item-1", toolKind: "command", phase: "finished", title: "Run command", details: [] }
      })
    ).toEqual({
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
    expect(parseBridgeToExtension({ type: "bridge.ready", version: 3, extra: true })).toEqual({
      ok: false,
      error: "Message has invalid fields"
    });
    expect(
      parseBridgeToExtension({
        type: "agent.event",
        version: 3,
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
          version: 3,
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
        version: 3,
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
        version: 3,
        clientSessionId: "page-1",
        providerId: "codex",
        extra: true
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });

    expect(parseExtensionToBridge({ type: "heartbeat", version: 3, clientSessionId: "page-1" })).toEqual({
      ok: false,
      error: "Message has invalid fields"
    });
  });

  it("rejects_extension_request_envelopes_with_private_reasoning_or_prompt_fields", () => {
    expect(
      parseExtensionToBridge({
        type: "session.cancel",
        version: 3,
        clientSessionId: "page-1",
        reasoning: "private"
      })
    ).toEqual({ ok: false, error: "Message has invalid fields" });

    expect(parseExtensionToBridge({ type: "session.start", version: 3, clientSessionId: "page-1", providerId: "codex", prompt: "secret" })).toEqual({
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
          version: 3,
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
      expect(parseBridgeToExtension({ type: "session.error", version: 3, clientSessionId: "page-1", message: "failed", code })).toMatchObject({
        ok: true
      });
    }
  });

  it("rejects_unknown_session_error_codes", () => {
    expect(
      parseBridgeToExtension({
        type: "session.error",
        version: 3,
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
