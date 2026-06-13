import { describe, expect, it } from "vitest";
import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";
import { SpeechCredentialClient, type SpeechCredentialTransport } from "./speech-credentials";
import type { BridgeConnectionSnapshot } from "./connection";

describe("SpeechCredentialClient", () => {
  it("uses_removed_credential_status_when_environment_fallback_remains", () => {
    const transport = new FakeSpeechCredentialTransport();
    const client = new SpeechCredentialClient({ transport });

    client.removeApiKey();
    transport.emit({
      type: "speech.credentials.removed",
      version: 3,
      configured: true,
      source: "environment",
      redactedKey: "sk-...env1"
    });

    expect(client.getSnapshot()).toMatchObject({
      status: { configured: true, source: "environment", redactedKey: "sk-...env1" },
      busy: false,
      successMessage: "OpenAI API key removed. Using environment key."
    });
  });

  it("clears_busy_and_surfaces_bridge_errors_while_connected", () => {
    const transport = new FakeSpeechCredentialTransport();
    const client = new SpeechCredentialClient({ transport });

    client.testApiKey();
    transport.setSnapshot({
      connected: true,
      ready: false,
      setupError: "Codex setup failed.",
      availability: { status: "error", message: "Codex setup failed.", code: "codex_setup_failed" }
    });

    expect(client.getSnapshot()).toMatchObject({
      busy: false,
      error: "Codex setup failed.",
      successMessage: undefined
    });
  });
});

class FakeSpeechCredentialTransport implements SpeechCredentialTransport {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly messageListeners = new Set<(message: BridgeToExtension) => void>();
  private snapshot: BridgeConnectionSnapshot = {
    connected: true,
    ready: true,
    availability: { status: "ready" }
  };

  post(message: ExtensionToBridge) {
    this.postedMessages.push(message);
    return { ok: true as const };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToMessages(listener: (message: BridgeToExtension) => void) {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  getSnapshot(): BridgeConnectionSnapshot {
    return this.snapshot;
  }

  emit(message: BridgeToExtension): void {
    for (const listener of this.messageListeners) listener(message);
  }

  setSnapshot(snapshot: BridgeConnectionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
