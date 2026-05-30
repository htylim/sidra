// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageKey } from "./page-key";
import type { SidePanelSnapshot } from "./side-panel-controller";
import { SidePanelView } from "./side-panel-view";

afterEach(() => {
  cleanup();
});

type SnapshotOptions = {
  title?: string;
  favIconUrl?: string;
  contextLabel?: string;
  contextState?: SidePanelSnapshot["activeSession"]["contextState"];
  captureMode?: SidePanelSnapshot["activeSession"]["captureMode"];
  draftPrompt?: string;
  transcript?: SidePanelSnapshot["activeSession"]["transcript"];
  quickActions?: SidePanelSnapshot["activeSession"]["quickActions"];
  pendingPromptCount?: number;
  turnInFlight?: boolean;
  canCancelTurn?: boolean;
};

function snapshotForPage(options: SnapshotOptions = {}): SidePanelSnapshot {
  return {
    bridge: readyBridge,
    activePage: {
      status: "ready",
      pageKey: "https://example.com/article" as PageKey,
      url: "https://example.com/article",
      displayTitle: options.title ?? "Example Article",
      favIconUrl: options.favIconUrl
    },
    activeSession: {
      pageKey: "https://example.com/article" as SidePanelSnapshot["activeSession"]["pageKey"],
      clientSessionId: "client-1",
      captureMode: options.captureMode ?? "readable",
      draftPrompt: options.draftPrompt ?? "",
      contextState: options.contextState ?? { status: "none", label: "No context sent yet" },
      transcript: options.transcript ?? [],
      pendingPromptCount: options.pendingPromptCount ?? 0,
      sessionStarted: false,
      starting: false,
      turnInFlight: options.turnInFlight ?? false,
      canCancelTurn: options.canCancelTurn ?? false,
      quickActions: options.quickActions ?? []
    }
  };
}

function snapshotForUnsupportedPage(): SidePanelSnapshot {
  return {
    ...snapshotForPage(),
    bridge: { ...readyBridge, canUseChat: false },
    activePage: { status: "unsupported", reason: "unsupported_url", url: "chrome://extensions" },
    activeSession: {
      ...snapshotForPage().activeSession,
      pageKey: "" as PageKey,
      clientSessionId: "",
      transcript: []
    }
  };
}

function createSnapshot(bridge: SidePanelSnapshot["bridge"]): SidePanelSnapshot {
  return {
    ...snapshotForPage(),
    bridge
  };
}

function renderSnapshot(bridge: SidePanelSnapshot["bridge"]): string {
  return renderToStaticMarkup(
    <SidePanelView
      snapshot={createSnapshot(bridge)}
      onSendPrompt={() => false}
      onCaptureAndSend={() => false}
      onQuickAction={() => false}
      onCancelTurn={() => false}
      onRespondToPermission={() => false}
      onDraftPromptChange={() => undefined}
      onCaptureModeChange={() => undefined}
      onNewChat={() => undefined}
      onRetryBridge={() => undefined}
      onOpenSettings={() => undefined}
    />
  );
}

function renderPageSnapshot(snapshot: SidePanelSnapshot): string {
  return renderToStaticMarkup(
    <SidePanelView
      snapshot={snapshot}
      onSendPrompt={() => false}
      onCaptureAndSend={() => false}
      onQuickAction={() => false}
      onCancelTurn={() => false}
      onRespondToPermission={() => false}
      onDraftPromptChange={() => undefined}
      onCaptureModeChange={() => undefined}
      onNewChat={() => undefined}
      onRetryBridge={() => undefined}
      onOpenSettings={() => undefined}
    />
  );
}

function renderInteractiveSnapshot(
  snapshot: SidePanelSnapshot,
  overrides: Partial<{
    onSendPrompt(prompt: string): boolean;
    onCaptureAndSend(prompt: string): boolean | Promise<boolean>;
    onQuickAction(actionId: string): boolean | Promise<boolean>;
    onCancelTurn(): boolean;
    onRespondToPermission(requestId: string, decision: "allow_once" | "allow_for_session" | "deny"): boolean;
    onDraftPromptChange(text: string): void;
    onCaptureModeChange(captureMode: SidePanelSnapshot["activeSession"]["captureMode"]): void;
    onNewChat(): void;
    onOpenSettings(): void;
  }> = {}
) {
  let currentSnapshot = snapshot;
  const renderedView = renderView();

  function renderView() {
    return render(
      <SidePanelView
        snapshot={currentSnapshot}
        onSendPrompt={overrides.onSendPrompt ?? (() => false)}
        onCaptureAndSend={overrides.onCaptureAndSend ?? (() => false)}
        onQuickAction={overrides.onQuickAction ?? (() => false)}
        onCancelTurn={overrides.onCancelTurn ?? (() => false)}
        onRespondToPermission={overrides.onRespondToPermission ?? (() => false)}
        onDraftPromptChange={(text) => {
          currentSnapshot = {
            ...currentSnapshot,
            activeSession: { ...currentSnapshot.activeSession, draftPrompt: text }
          };
          overrides.onDraftPromptChange?.(text);
          renderedView.rerender(viewElement());
        }}
        onCaptureModeChange={(captureMode) => {
          currentSnapshot = {
            ...currentSnapshot,
            activeSession: { ...currentSnapshot.activeSession, captureMode }
          };
          overrides.onCaptureModeChange?.(captureMode);
          renderedView.rerender(viewElement());
        }}
        onNewChat={overrides.onNewChat ?? (() => undefined)}
        onRetryBridge={() => undefined}
        onOpenSettings={overrides.onOpenSettings ?? (() => undefined)}
      />
    );
  }

  function viewElement() {
    return (
      <SidePanelView
        snapshot={currentSnapshot}
        onSendPrompt={overrides.onSendPrompt ?? (() => false)}
        onCaptureAndSend={overrides.onCaptureAndSend ?? (() => false)}
        onQuickAction={overrides.onQuickAction ?? (() => false)}
        onCancelTurn={overrides.onCancelTurn ?? (() => false)}
        onRespondToPermission={overrides.onRespondToPermission ?? (() => false)}
        onDraftPromptChange={(text) => {
          currentSnapshot = {
            ...currentSnapshot,
            activeSession: { ...currentSnapshot.activeSession, draftPrompt: text }
          };
          overrides.onDraftPromptChange?.(text);
          renderedView.rerender(viewElement());
        }}
        onCaptureModeChange={(captureMode) => {
          currentSnapshot = {
            ...currentSnapshot,
            activeSession: { ...currentSnapshot.activeSession, captureMode }
          };
          overrides.onCaptureModeChange?.(captureMode);
          renderedView.rerender(viewElement());
        }}
        onNewChat={overrides.onNewChat ?? (() => undefined)}
        onRetryBridge={() => undefined}
        onOpenSettings={overrides.onOpenSettings ?? (() => undefined)}
      />
    );
  }

  return renderedView;
}

const readyBridge: SidePanelSnapshot["bridge"] = {
  connected: true,
  ready: true,
  setupError: undefined,
  canUseChat: true,
  availability: { status: "ready" }
};

const checkingBridge: SidePanelSnapshot["bridge"] = {
  connected: true,
  ready: false,
  setupError: undefined,
  canUseChat: false,
  availability: { status: "checking", message: "Connecting to Sidra bridge..." }
};

describe("SidePanelView bridge setup", () => {
  it("renders checking setup panel and disables prompt controls", () => {
    const markup = renderSnapshot(checkingBridge);

    expect(markup).toContain("Connecting to Sidra bridge...");
    expect(markup).toContain("<textarea");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Capture + Send");
  });

  it("renders bridge error panel with retry", () => {
    const markup = renderSnapshot({
      connected: true,
      ready: false,
      setupError: "bridge failed",
      canUseChat: false,
      availability: { status: "error", message: "bridge failed", code: "invalid_message" }
    });

    expect(markup).toContain("Bridge setup needs attention");
    expect(markup).toContain("bridge failed");
    expect(markup).toContain("Retry");
  });

  it("renders unavailable bridge panel with retry", () => {
    const markup = renderSnapshot({
      connected: false,
      ready: false,
      setupError: "Sidra cannot connect to the local bridge.",
      canUseChat: false,
      availability: {
        status: "unavailable",
        message: "Sidra cannot connect to the local bridge."
      }
    });

    expect(markup).toContain("Sidra cannot connect to the local bridge.");
    expect(markup).toContain("Retry");
  });

  it("renders empty chat only when chat is usable", () => {
    const blockedMarkup = renderSnapshot(checkingBridge);
    const readyMarkup = renderSnapshot({
      connected: true,
      ready: true,
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });

    expect(blockedMarkup).not.toContain("Ask anything about this page");
    expect(readyMarkup).toContain("Ask anything about this page");
  });

  it("keeps Retry as the only action in blocked chat state", () => {
    const markup = renderSnapshot({
      connected: false,
      ready: false,
      setupError: "Sidra cannot connect to the local bridge.",
      canUseChat: false,
      availability: {
        status: "unavailable",
        message: "Sidra cannot connect to the local bridge."
      }
    });

    expect(markup).toContain("Retry");
    expect(markup).not.toContain("Summarize this page");
    expect(markup).toContain("disabled=\"\"");
  });
});

describe("SidePanelView URL sessions", () => {
  it("renders_centered_empty_state_heading_helper_and_quick_action_grid", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        quickActions: [{ id: "summarize-page", label: "Summarize this page" }]
      })
    );

    expect(screen.getByText("Ask anything about this page")).not.toBeNull();
    expect(screen.getByText("Use the actions below or ask your own question.")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Quick actions" })).not.toBeNull();
  });

  it("renders_default_quick_action_in_empty_session", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        quickActions: [{ id: "summarize-page", label: "Summarize this page" }]
      })
    );

    expect(screen.getByRole("button", { name: "Summarize this page" })).not.toBeNull();
  });

  it("clicking_new_chat_invokes_onNewChat", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    renderInteractiveSnapshot(snapshotForPage(), { onNewChat });

    await user.click(screen.getByRole("button", { name: "New chat" }));

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("renders_empty_state_quick_actions_after_new_chat_snapshot", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [],
        quickActions: [{ id: "summarize-page", label: "Summarize this page" }]
      })
    );

    expect(screen.getByText("Ask anything about this page")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Summarize this page" })).not.toBeNull();
  });

  it("new_chat_button_remains_available_while_turn_is_running", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }), { onNewChat });

    const newChatButton = screen.getByRole("button", { name: "New chat" });
    expect(newChatButton).toHaveProperty("disabled", false);

    await user.click(newChatButton);

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("renders_custom_quick_actions_from_snapshot", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        quickActions: [
          { id: "explain", label: "Explain" },
          { id: "questions", label: "Find questions" }
        ]
      })
    );

    expect(screen.getByRole("button", { name: "Explain" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Find questions" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Summarize this page" })).toBeNull();
  });

  it("hides_quick_actions_when_disabled", () => {
    renderInteractiveSnapshot(snapshotForPage({ quickActions: [] }));

    expect(screen.queryByRole("group", { name: "Quick actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Summarize this page" })).toBeNull();
  });

  it("hides_quick_actions_when_active_session_has_transcript", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        quickActions: [{ id: "summarize-page", label: "Summarize this page" }],
        transcript: [{ kind: "user_message", role: "user", text: "hello" }]
      })
    );

    expect(screen.queryByRole("button", { name: "Summarize this page" })).toBeNull();
  });

  it("does_not_show_quick_actions_when_bridge_is_blocked", () => {
    renderInteractiveSnapshot({
      ...snapshotForPage({ quickActions: [{ id: "summarize-page", label: "Summarize this page" }] }),
      bridge: checkingBridge
    });

    expect(screen.queryByRole("button", { name: "Summarize this page" })).toBeNull();
  });

  it("does_not_show_quick_actions_for_unsupported_pages", () => {
    renderInteractiveSnapshot({
      ...snapshotForUnsupportedPage(),
      activeSession: {
        ...snapshotForUnsupportedPage().activeSession,
        quickActions: [{ id: "summarize-page", label: "Summarize this page" }]
      }
    });

    expect(screen.queryByRole("button", { name: "Summarize this page" })).toBeNull();
  });

  it("clicking_quick_action_calls_onQuickAction with_the_action_id", async () => {
    const user = userEvent.setup();
    const onQuickAction = vi.fn(() => true);
    renderInteractiveSnapshot(
      snapshotForPage({ quickActions: [{ id: "summarize-page", label: "Summarize this page" }] }),
      { onQuickAction }
    );

    await user.click(screen.getByRole("button", { name: "Summarize this page" }));

    expect(onQuickAction).toHaveBeenCalledWith("summarize-page");
  });

  it("clicking_quick_action_does_not_write_the_prompt_to_the_draft", async () => {
    const user = userEvent.setup();
    const onDraftPromptChange = vi.fn();
    renderInteractiveSnapshot(
      snapshotForPage({ quickActions: [{ id: "summarize-page", label: "Summarize this page" }] }),
      { onDraftPromptChange }
    );

    await user.click(screen.getByRole("button", { name: "Summarize this page" }));

    expect(onDraftPromptChange).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("header_settings_button_calls_onOpenSettings", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    renderInteractiveSnapshot(snapshotForPage(), { onOpenSettings });

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("does_not_receive_quick_action_prompts_in_the_snapshot", () => {
    const snapshot = snapshotForPage({
      quickActions: [{ id: "summarize-page", label: "Summarize this page" }]
    });

    expect(JSON.stringify(snapshot.activeSession.quickActions)).not.toContain("prompt");
  });

  it("renders_active_page_title_and_context_state_from_snapshot", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        title: "Readable Article",
        contextLabel: "No context sent yet"
      })
    );
    expect(markup).toContain("Readable Article");
    expect(markup).toContain("No context sent yet");
  });

  it("renders_controlled_draft_prompt_from_snapshot", () => {
    const markup = renderPageSnapshot(snapshotForPage({ draftPrompt: "saved draft" }));
    expect(markup).toContain("saved draft");
  });

  it("renders_unsupported_page_state_without_previous_transcript", () => {
    render(
      <SidePanelView
        snapshot={snapshotForUnsupportedPage()}
        onSendPrompt={() => false}
        onCaptureAndSend={() => false}
        onQuickAction={() => false}
        onCancelTurn={() => false}
        onRespondToPermission={() => false}
        onDraftPromptChange={() => undefined}
        onCaptureModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );
    expect(screen.getByText("chrome://extensions")).not.toBeNull();
    expect(screen.getAllByText("This page cannot be captured")).toHaveLength(2);
    expect(screen.queryByText("previous page text")).toBeNull();
  });

  it("disables_prompt_controls_and_hides_suggestions_for_unsupported_pages", () => {
    render(
      <SidePanelView
        snapshot={snapshotForUnsupportedPage()}
        onSendPrompt={() => false}
        onCaptureAndSend={() => false}
        onQuickAction={() => false}
        onCancelTurn={() => false}
        onRespondToPermission={() => false}
        onDraftPromptChange={() => undefined}
        onCaptureModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(screen.queryByText("Summarize this page")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Capture + Send" })).toHaveProperty("disabled", true);
  });

  it("calls_onDraftPromptChange_when_the_textarea_changes", async () => {
    const user = userEvent.setup();
    const onDraftPromptChange = vi.fn();
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "" }), { onDraftPromptChange });
    await user.type(screen.getByRole("textbox"), "new draft");
    expect(onDraftPromptChange).toHaveBeenCalledWith("new draft");
  });

  it("send_does_not_clear_the_draft_without_a_new_controller_snapshot", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "send me" }), { onCaptureAndSend });
    await user.click(screen.getByRole("button", { name: "Capture + Send" }));
    expect(onCaptureAndSend).toHaveBeenCalledWith("send me");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("send me");
  });

  it("renders_active_session_transcript_only", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [{ kind: "user_message", role: "user", text: "active page text" }]
      })
    );
    expect(markup).toContain("active page text");
    expect(markup).not.toContain("inactive page text");
  });

  it("keeps_empty_state_scoped_to_the_active_session", () => {
    const markup = renderPageSnapshot(snapshotForPage({ transcript: [] }));
    expect(markup).toContain("Ask anything about this page");
  });

  describe("current page card integration", () => {
    it("renders_current_page_card_from_side_panel_snapshot", () => {
      renderInteractiveSnapshot(
        snapshotForPage({
          title: "Readable Article",
          favIconUrl: "https://example.com/favicon.ico",
          contextState: { status: "attached", label: "Context attached", capturedAt: "2026-05-10T12:00:00.000Z" }
        })
      );

      expect(screen.getByLabelText("Current page")).not.toBeNull();
      expect(screen.getByText("Readable Article")).not.toBeNull();
      expect(screen.getByText("Context attached")).not.toBeNull();
      expect(document.querySelector("img.page-favicon")?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    });
  });
});

describe("SidePanelView Capture + Send", () => {
  it("renders_cancel_button_while_turn_is_in_flight", () => {
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }));

    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Capture + Send" })).toBeNull();
  });

  it("renders_disabled_cancel_after_cancel_is_requested_until_terminal_event", () => {
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: false }));

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
  });

  it("does_not_show_cancel_before_provider_turn_is_in_flight", () => {
    renderInteractiveSnapshot(snapshotForPage({ pendingPromptCount: 1, turnInFlight: false, canCancelTurn: false }));

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Capture + Send" })).toHaveProperty("disabled", true);
  });

  it("clicking_cancel_calls_onCancelTurn", async () => {
    const user = userEvent.setup();
    const onCancelTurn = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }), { onCancelTurn });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancelTurn).toHaveBeenCalledTimes(1);
  });

  it("pressing_escape_cancels_the_active_turn_from_the_document", async () => {
    const user = userEvent.setup();
    const onCancelTurn = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }), { onCancelTurn });

    document.body.focus();
    await user.keyboard("{Escape}");

    expect(onCancelTurn).toHaveBeenCalledTimes(1);
  });

  it("pressing_escape_cancels_when_focus_is_outside_the_composer", async () => {
    const user = userEvent.setup();
    const onCancelTurn = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }), { onCancelTurn });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.keyboard("{Escape}");

    expect(onCancelTurn).toHaveBeenCalledTimes(1);
  });

  it("pressing_escape_after_cancel_is_requested_does_not_call_onCancelTurn_again", async () => {
    const user = userEvent.setup();
    const onCancelTurn = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: false }), { onCancelTurn });

    await user.keyboard("{Escape}");

    expect(onCancelTurn).not.toHaveBeenCalled();
  });

  it("pressing_escape_while_idle_does_not_cancel", async () => {
    const user = userEvent.setup();
    const onCancelTurn = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage(), { onCancelTurn });

    await user.keyboard("{Escape}");

    expect(onCancelTurn).not.toHaveBeenCalled();
  });

  it("pressing_enter_while_turn_is_in_flight_does_not_send", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "hello", turnInFlight: true, canCancelTurn: true }), {
      onCaptureAndSend
    });

    await user.keyboard("{Enter}");

    expect(onCaptureAndSend).not.toHaveBeenCalled();
  });

  it("clicking_send_while_turn_is_in_flight_does_not_send", () => {
    const onCaptureAndSend = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "hello", turnInFlight: true, canCancelTurn: true }), {
      onCaptureAndSend
    });

    expect(screen.queryByRole("button", { name: "Capture + Send" })).toBeNull();
    expect(onCaptureAndSend).not.toHaveBeenCalled();
  });

  it("disables_prompt_input_and_options_while_turn_is_in_flight", () => {
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }));

    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Prompt options" })).toHaveProperty("disabled", true);
  });

  it("keeps_cancel_enabled_when_prompt_controls_are_disabled_by_running_turn", () => {
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: true }));

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
  });

  it("does_not_cancel_when_canCancelTurn_is_false", async () => {
    const user = userEvent.setup();
    const onCancelTurn = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ turnInFlight: true, canCancelTurn: false }), { onCancelTurn });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancelTurn).not.toHaveBeenCalled();
  });

  it("clicking_capture_and_send_calls_onCaptureAndSend_with_trimmed_prompt", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "  summarize  " }), { onCaptureAndSend });

    await user.click(screen.getByRole("button", { name: "Capture + Send" }));

    expect(onCaptureAndSend).toHaveBeenCalledWith("summarize");
  });

  it("pressing_enter_uses_capture_and_send", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "summarize" }), { onCaptureAndSend });

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Enter}");

    expect(onCaptureAndSend).toHaveBeenCalledWith("summarize");
  });

  it("clicking_capture_and_send_is_disabled_for_unsupported_pages", () => {
    render(
      <SidePanelView
        snapshot={snapshotForUnsupportedPage()}
        onSendPrompt={() => false}
        onCaptureAndSend={() => false}
        onQuickAction={() => false}
        onCancelTurn={() => false}
        onRespondToPermission={() => false}
        onDraftPromptChange={() => undefined}
        onCaptureModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Capture + Send" })).toHaveProperty("disabled", true);
  });

  it("renders_context_marker_and_does_not_render_raw_page_content", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [
          { kind: "status", role: "status", tone: "neutral", text: "Page context attached" },
          { kind: "user_message", role: "user", text: "summarize" }
        ]
      })
    );

    expect(markup).toContain("Page context attached");
    expect(markup).toContain("summarize");
    expect(markup).not.toContain("Raw captured article text");
  });

  it("renders_page_card_context_state_after_context_send", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        contextState: {
          status: "attached",
          label: "Context attached",
          capturedAt: "2026-05-10T12:00:00.000Z"
        }
      })
    );

    expect(markup).toContain("Context attached");
  });

  it("renders_content_too_large_context_state_in_page_card", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        contextState: {
          status: "content_too_large",
          label: "Content too large",
          capturedAt: "2026-05-10T12:00:00.000Z",
          reason: "content_too_large"
        }
      })
    );

    expect(markup).toContain("Content too large");
  });

  it("renders_full_dom_attached_context_state_in_page_card", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        contextState: {
          status: "full_dom_attached",
          label: "Full DOM attached",
          capturedAt: "2026-05-10T12:00:00.000Z"
        }
      })
    );

    expect(markup).toContain("Full DOM attached");
  });

  it("renders_full_dom_too_large_context_state_in_page_card", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        contextState: {
          status: "full_dom_too_large",
          label: "Full DOM skipped: too large",
          capturedAt: "2026-05-10T12:00:00.000Z",
          reason: "full_dom_too_large"
        }
      })
    );

    expect(markup).toContain("Full DOM skipped: too large");
  });
});

describe("SidePanelView rich transcript rendering", () => {
  it("renders_inline_permission_card_with_safe_request_text", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "permission_request",
            role: "permission",
            requestId: "permission-1",
            permissionKey: "shell:ls",
            title: "Run command",
            description: "Allow listing files.",
            metadata: { toolName: "shell", commandPreview: "ls" },
            status: "pending"
          }
        ],
        turnInFlight: true,
        canCancelTurn: true
      })
    );

    expect(screen.getByText("Run command")).not.toBeNull();
    expect(screen.getByText("Allow listing files.")).not.toBeNull();
    expect(screen.getByText("Scope: shell:ls")).not.toBeNull();
    expect(screen.getByText("shell")).not.toBeNull();
    expect(screen.getByText("ls")).not.toBeNull();
  });

  it("does_not_render_raw_private_permission_metadata", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "permission_request",
            role: "permission",
            requestId: "permission-1",
            permissionKey: "shell:ls",
            title: "Run command",
            metadata: { toolName: "shell", commandPreview: "ls" },
            status: "pending"
          }
        ]
      })
    );

    expect(markup).not.toContain("rawInput");
    expect(markup).not.toContain("stdout");
    expect(markup).not.toContain("pageContent");
  });

  it.each([
    ["Allow once", "allow_once"],
    ["Allow for this session", "allow_for_session"],
    ["Deny", "deny"]
  ] as const)("permission_card_%s_calls_onRespondToPermission", async (label, decision) => {
    const user = userEvent.setup();
    const onRespondToPermission = vi.fn(() => true);
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "permission_request",
            role: "permission",
            requestId: "permission-1",
            permissionKey: "shell:ls",
            title: "Run command",
            status: "pending"
          }
        ],
        turnInFlight: true,
        canCancelTurn: true
      }),
      { onRespondToPermission }
    );

    await user.click(screen.getByRole("button", { name: decision === "deny" ? "Deny shell:ls" : `${label} for shell:ls` }));

    expect(onRespondToPermission).toHaveBeenCalledWith("permission-1", decision);
  });

  it.each([
    ["allowed_once", "Allowed once"],
    ["allowed_for_session", "Allowed for this session"],
    ["denied", "Denied"],
    ["unavailable", "Unavailable"]
  ] as const)("resolved_permission_card_%s_disables_actions", (status, label) => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "permission_request",
            role: "permission",
            requestId: "permission-1",
            permissionKey: "shell:ls",
            title: "Run command",
            status
          }
        ]
      })
    );

    expect(screen.getByText(label)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Allow once for shell:ls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow for this session for shell:ls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny shell:ls" })).toBeNull();
  });

  it("pending_permission_card_keeps_prompt_controls_disabled_while_turn_is_in_flight", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "permission_request",
            role: "permission",
            requestId: "permission-1",
            permissionKey: "shell:ls",
            title: "Run command",
            status: "pending"
          }
        ],
        turnInFlight: true,
        canCancelTurn: true
      })
    );

    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
  });

  it("renders_user_prompt_as_escaped_text", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [{ kind: "user_message", role: "user", text: "<img src=x onerror=alert(1)>hello" }]
      })
    );

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;hello");
    expect(markup).not.toContain("<img src=");
  });

  it("renders_sanitized_assistant_markdown_without_raw_html", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "## Answer\n\n<strong data-secret=\"raw\">raw html</strong>\n\n- item",
            text: "Answer",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    expect(markup).toContain("<h2>Answer</h2>");
    expect(markup).toContain("<li>item</li>");
    expect(markup).not.toContain("data-secret");
    expect(markup).not.toContain("<strong");
  });

  it("renders_assistant_links_with_blank_target_and_safe_rel", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "[Open example](https://example.com/path)",
            text: "Open example",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    const link = screen.getByRole("link", { name: "Open example" }) as HTMLAnchorElement;
    expect(link.href).toBe("https://example.com/path");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer noopener");
  });

  it("renders_assistant_mailto_links_with_blank_target_and_safe_rel", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "[Email support](mailto:support@example.com)",
            text: "Email support",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    const link = screen.getByRole("link", { name: "Email support" }) as HTMLAnchorElement;
    expect(link.href).toBe("mailto:support@example.com");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer noopener");
  });

  it.each([
    ["javascript link", "[bad](javascript:alert(1))", "bad"],
    ["data link", "[data](data:text/html,secret)", "data"],
    ["malformed link", "[malformed](https://[broken)", "malformed"],
    ["protocol-relative link", "[protocol relative](//example.com/path)", "protocol relative"]
  ])("renders_%s_without_clickable_href", (_caseName, markdown, linkText) => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown,
            text: linkText,
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    expect(screen.queryByRole("link", { name: linkText })).toBeNull();
    expect(screen.getByText(linkText).closest("a")).toBeNull();
  });

  it("renders_relative_markdown_links_without_clickable_href", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "[relative](/local/path)",
            text: "relative",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    expect(screen.queryByRole("link", { name: "relative" })).toBeNull();
    expect(screen.getByText("relative").closest("a")).toBeNull();
  });

  it("does_not_render_markdown_images", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "![secret image](https://example.com/image.png)",
            text: "",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("secret image");
  });

  it("renders_code_blocks_with_copy_buttons", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "```ts\nconst value = 1;\n```",
            text: "const value = 1;",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    expect(screen.getByText("const value = 1;")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy code" })).not.toBeNull();
  });

  it("clicking_code_copy_writes_code_to_clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "```json\n{\"ok\": true}\n```",
            text: "{\"ok\": true}",
            activity: [],
            status: "complete"
          }
        ]
      })
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("{\"ok\": true}\n");
  });

  it("renders_activity_collapsed_by_default", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "",
            text: "",
            activity: [{ kind: "progress", label: "Reading" }],
            status: "streaming"
          }
        ]
      })
    );

    const details = screen.getByText("Activity").closest("details");
    expect(details?.open).toBe(false);
  });

  it("shows_safe_activity_inside_activity_disclosure_when_opened", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "",
            text: "",
            activity: [{ kind: "progress", label: "Reading" }],
            status: "streaming"
          }
        ]
      })
    );

    await user.click(screen.getByText("Activity"));

    expect(screen.getByText("Reading")).not.toBeNull();
  });

  it("renders_error_status_entries_as_distinct_status_cards", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [{ kind: "status", role: "status", tone: "error", text: "Provider failed" }]
      })
    );

    const status = screen.getByRole("alert");
    expect(status.textContent).toBe("Provider failed");
    expect(status.closest(".status-card")?.className).toContain("error");
  });

  it("renders_failed_assistant_turn_as_not_streaming_with_partial_output_visible", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "Partial output",
            text: "Partial output",
            activity: [],
            status: "failed"
          }
        ]
      })
    );

    expect(screen.getByText("Partial output")).not.toBeNull();
    expect(screen.queryByText("Streaming")).toBeNull();
  });

  it("renders_cancelled_status_entries_as_distinct_status_cards", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [{ kind: "status", role: "status", tone: "cancelled", text: "Assistant turn cancelled" }]
      })
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Assistant turn cancelled");
    expect(status.closest(".status-card")?.className).toContain("cancelled");
  });
});

describe("SidePanelView prompt options", () => {
  it("opens_a_compact_prompt_options_popover_from_the_composer_button", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(snapshotForPage());

    await user.click(screen.getByRole("button", { name: "Prompt options" }));

    expect(screen.getByRole("group", { name: "Prompt options" })).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Send Full DOM" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("renders_send_full_dom_toggle_off_for_readable_capture_mode", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(snapshotForPage({ captureMode: "readable" }));

    await user.click(screen.getByRole("button", { name: "Prompt options" }));

    expect(screen.getByRole("checkbox", { name: "Send Full DOM" })).toHaveProperty("checked", false);
  });

  it("renders_send_full_dom_toggle_on_for_full_dom_capture_mode", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(snapshotForPage({ captureMode: "full_dom" }));

    await user.click(screen.getByRole("button", { name: "Prompt options" }));

    expect(screen.getByRole("checkbox", { name: "Send Full DOM" })).toHaveProperty("checked", true);
  });

  it("calls_onCaptureModeChange_with_full_dom_when_toggle_is_enabled", async () => {
    const user = userEvent.setup();
    const onCaptureModeChange = vi.fn();
    renderInteractiveSnapshot(snapshotForPage(), { onCaptureModeChange });

    await user.click(screen.getByRole("button", { name: "Prompt options" }));
    await user.click(screen.getByRole("checkbox", { name: "Send Full DOM" }));

    expect(onCaptureModeChange).toHaveBeenCalledWith("full_dom");
  });

  it("calls_onCaptureModeChange_with_readable_when_toggle_is_disabled", async () => {
    const user = userEvent.setup();
    const onCaptureModeChange = vi.fn();
    renderInteractiveSnapshot(snapshotForPage({ captureMode: "full_dom" }), { onCaptureModeChange });

    await user.click(screen.getByRole("button", { name: "Prompt options" }));
    await user.click(screen.getByRole("checkbox", { name: "Send Full DOM" }));

    expect(onCaptureModeChange).toHaveBeenCalledWith("readable");
  });

  it("disables_prompt_options_when_chat_controls_are_disabled", () => {
    render(
      <SidePanelView
        snapshot={snapshotForUnsupportedPage()}
        onSendPrompt={() => false}
        onCaptureAndSend={() => false}
        onQuickAction={() => false}
        onCancelTurn={() => false}
        onRespondToPermission={() => false}
        onDraftPromptChange={() => undefined}
        onCaptureModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Prompt options" })).toHaveProperty("disabled", true);
  });

  it("closes_prompt_options_when_chat_controls_become_disabled", async () => {
    const user = userEvent.setup();
    const initialSnapshot = snapshotForPage();
    const renderedView = render(
      <SidePanelView
        snapshot={initialSnapshot}
        onSendPrompt={() => false}
        onCaptureAndSend={() => false}
        onQuickAction={() => false}
        onCancelTurn={() => false}
        onRespondToPermission={() => false}
        onDraftPromptChange={() => undefined}
        onCaptureModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Prompt options" }));
    expect(screen.getByRole("checkbox", { name: "Send Full DOM" })).not.toBeNull();

    renderedView.rerender(
      <SidePanelView
        snapshot={{
          ...initialSnapshot,
          bridge: { ...initialSnapshot.bridge, canUseChat: false, availability: { status: "checking", message: "Checking" } }
        }}
        onSendPrompt={() => false}
        onCaptureAndSend={() => false}
        onQuickAction={() => false}
        onCancelTurn={() => false}
        onRespondToPermission={() => false}
        onDraftPromptChange={() => undefined}
        onCaptureModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(screen.queryByRole("checkbox", { name: "Send Full DOM" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prompt options" })).toHaveProperty("disabled", true);
  });

  it("does_not_send_prompt_when_only_toggling_full_dom", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "summarize" }), { onCaptureAndSend });

    await user.click(screen.getByRole("button", { name: "Prompt options" }));
    await user.click(screen.getByRole("checkbox", { name: "Send Full DOM" }));

    expect(onCaptureAndSend).not.toHaveBeenCalled();
  });
});
