import { describe, expect, it } from "vitest";
import { parseExtensionToBridge } from "./index";

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
});
