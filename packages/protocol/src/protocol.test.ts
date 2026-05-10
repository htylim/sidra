import { describe, expect, it } from "vitest";
import { parseBridgeToExtension, parseExtensionToBridge } from "./index";

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
});
