// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageKey } from "./page-key";
import type { SidePanelSnapshot } from "./side-panel-controller";
import { SidePanelView } from "./side-panel-view";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

type SnapshotOptions = {
  title?: string;
  favIconUrl?: string;
  contextLabel?: string;
  contextState?: SidePanelSnapshot["activeSession"]["contextState"];
  captureMode?: SidePanelSnapshot["activeSession"]["captureMode"];
  sendMode?: SidePanelSnapshot["activeSession"]["sendMode"];
  draftPrompt?: string;
  transcript?: SidePanelSnapshot["activeSession"]["transcript"];
  quickActions?: SidePanelSnapshot["activeSession"]["quickActions"];
  pendingPromptCount?: number;
  turnInFlight?: boolean;
  canCancelTurn?: boolean;
};

function assistantTurnWithToolActivity(
  phase: "started" | "completed",
  commandOutput: Array<{ stream: "stdout" | "stderr" | "unknown"; text: string }> = []
): NonNullable<SnapshotOptions["transcript"]>[number] {
  return {
    kind: "assistant_turn",
    role: "assistant",
    markdown: "",
    text: "",
    activity: {
      reasoningSummary: "",
      tools: [
        {
          kind: "tool",
          itemId: "command-1",
          toolKind: "command",
          phase,
          title: "Run command",
          details: [{ label: "Command", value: "pnpm test" }],
          commandOutput
        }
      ]
    },
    status: "streaming"
  };
}

function assistantTurnWithWebSearchActivity(): NonNullable<SnapshotOptions["transcript"]>[number] {
  return {
    kind: "assistant_turn",
    role: "assistant",
    markdown: "",
    text: "",
    activity: {
      reasoningSummary: "",
      tools: [
        {
          kind: "tool",
          itemId: "search-1",
          toolKind: "web_search",
          phase: "completed",
          title: "Search web",
          details: [{ label: "Query", value: "infobae lorena maciel tato young" }],
          commandOutput: []
        },
        {
          kind: "tool",
          itemId: "search-2",
          toolKind: "web_search",
          phase: "completed",
          title: "Search web",
          details: [{ label: "Query", value: "site:infobae.com/teleshow lorena maciel" }],
          commandOutput: []
        }
      ]
    },
    status: "streaming"
  };
}

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
      sendMode: options.sendMode ?? "capture",
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
      onSendModeChange={() => undefined}
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
      onSendModeChange={() => undefined}
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
    onSendModeChange(sendMode: SidePanelSnapshot["activeSession"]["sendMode"]): void;
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
        onSendModeChange={(sendMode) => {
          currentSnapshot = {
            ...currentSnapshot,
            activeSession: { ...currentSnapshot.activeSession, sendMode }
          };
          overrides.onSendModeChange?.(sendMode);
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
        onSendModeChange={(sendMode) => {
          currentSnapshot = {
            ...currentSnapshot,
            activeSession: { ...currentSnapshot.activeSession, sendMode }
          };
          overrides.onSendModeChange?.(sendMode);
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
        onSendModeChange={() => undefined}
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
        onSendModeChange={() => undefined}
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
    it("renders_snapshot_favicon_and_no_chevron_in_the_side_panel", () => {
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
      expect(document.querySelector(`.${"chev"}${"ron"}`)).toBeNull();
      expect(screen.queryByText("›")).toBeNull();
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
        onSendModeChange={() => undefined}
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
            activity: { reasoningSummary: "", tools: [] },
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

  it("renders_assistant_markdown_paragraph_breaks", () => {
    const markup = renderPageSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "First paragraph.\n\nSecond paragraph.",
            text: "First paragraph.\n\nSecond paragraph.",
            activity: { reasoningSummary: "", tools: [] },
            status: "complete"
          }
        ]
      })
    );

    expect(markup).toContain("<p>First paragraph.</p>");
    expect(markup).toContain("<p>Second paragraph.</p>");
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
            activity: { reasoningSummary: "", tools: [] },
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
            activity: { reasoningSummary: "", tools: [] },
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
            activity: { reasoningSummary: "", tools: [] },
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
            activity: { reasoningSummary: "", tools: [] },
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
            activity: { reasoningSummary: "", tools: [] },
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
            activity: { reasoningSummary: "", tools: [] },
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
            activity: { reasoningSummary: "", tools: [] },
            status: "complete"
          }
        ]
      })
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("{\"ok\": true}\n");
  });

  describe("code copy feedback", () => {
    it("shows_copied_feedback_after_copying_code", async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn(() => Promise.resolve()) }
      });
      renderInteractiveSnapshot(
        snapshotForPage({
          transcript: [
            {
              kind: "assistant_turn",
              role: "assistant",
              markdown: "```ts\nconst value = 1;\n```",
              text: "const value = 1;",
              activity: { reasoningSummary: "", tools: [] },
              status: "complete"
            }
          ]
        })
      );

      await user.click(screen.getByRole("button", { name: "Copy code" }));

      expect(await screen.findByRole("button", { name: "Copied" })).not.toBeNull();
    });

    it("shows_copy_failed_feedback_when_clipboard_write_fails", async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) }
      });
      renderInteractiveSnapshot(
        snapshotForPage({
          transcript: [
            {
              kind: "assistant_turn",
              role: "assistant",
              markdown: "```ts\nconst value = 1;\n```",
              text: "const value = 1;",
              activity: { reasoningSummary: "", tools: [] },
              status: "complete"
            }
          ]
        })
      );

      await user.click(screen.getByRole("button", { name: "Copy code" }));

      expect(await screen.findByRole("button", { name: "Copy failed" })).not.toBeNull();
    });

    it("shows_copy_failed_feedback_when_clipboard_api_is_unavailable", async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined
      });
      renderInteractiveSnapshot(
        snapshotForPage({
          transcript: [
            {
              kind: "assistant_turn",
              role: "assistant",
              markdown: "```ts\nconst value = 1;\n```",
              text: "const value = 1;",
              activity: { reasoningSummary: "", tools: [] },
              status: "complete"
            }
          ]
        })
      );

      await user.click(screen.getByRole("button", { name: "Copy code" }));

      expect(await screen.findByRole("button", { name: "Copy failed" })).not.toBeNull();
    });

    it("resets_code_copy_feedback_after_a_short_timeout", async () => {
      vi.useFakeTimers();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn(() => Promise.resolve()) }
      });
      renderInteractiveSnapshot(
        snapshotForPage({
          transcript: [
            {
              kind: "assistant_turn",
              role: "assistant",
              markdown: "```ts\nconst value = 1;\n```",
              text: "const value = 1;",
              activity: { reasoningSummary: "", tools: [] },
              status: "complete"
            }
          ]
        })
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      });
      expect(screen.getByRole("button", { name: "Copied" })).not.toBeNull();

      act(() => vi.advanceTimersByTime(1800));

      expect(screen.getByRole("button", { name: "Copy code" })).not.toBeNull();
    });

    it("keeps_latest_code_copy_feedback_when_copy_attempts_overlap", async () => {
      const user = userEvent.setup();
      let rejectFirstCopy: ((error: Error) => void) | undefined;
      let resolveSecondCopy: (() => void) | undefined;
      const writeText = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirstCopy = reject;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSecondCopy = resolve;
            })
        );
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
              markdown: "```ts\nconst value = 1;\n```",
              text: "const value = 1;",
              activity: { reasoningSummary: "", tools: [] },
              status: "complete"
            }
          ]
        })
      );

      await user.click(screen.getByRole("button", { name: "Copy code" }));
      await user.click(screen.getByRole("button", { name: "Copy code" }));
      await act(async () => {
        resolveSecondCopy?.();
      });
      expect(await screen.findByRole("button", { name: "Copied" })).not.toBeNull();

      await act(async () => {
        rejectFirstCopy?.(new Error("late failure"));
      });

      expect(screen.getByRole("button", { name: "Copied" })).not.toBeNull();
    });

    it("does_not_update_code_copy_feedback_after_unmount", async () => {
      vi.useFakeTimers();
      let resolveCopy: (() => void) | undefined;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveCopy = resolve;
              })
          )
        }
      });
      const renderedView = renderInteractiveSnapshot(
        snapshotForPage({
          transcript: [
            {
              kind: "assistant_turn",
              role: "assistant",
              markdown: "```ts\nconst value = 1;\n```",
              text: "const value = 1;",
              activity: { reasoningSummary: "", tools: [] },
              status: "complete"
            }
          ]
        })
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      renderedView.unmount();
      await act(async () => {
        resolveCopy?.();
      });

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("does_not_render_activity_when_assistant_turn_has_no_visible_activity", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "",
            text: "",
            activity: { reasoningSummary: "", tools: [] },
            status: "streaming"
          }
        ]
      })
    );

    expect(screen.queryByText("Activity")).toBeNull();
  });

  it("renders_activity_collapsed_when_reasoning_summary_exists", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "",
            text: "",
            activity: { reasoningSummary: "Checked the code.", tools: [] },
            status: "streaming"
          }
        ]
      })
    );

    const details = screen.getByText("Activity").closest("details");
    expect(details?.open).toBe(false);
  });

  it("renders_activity_above_and_outside_the_assistant_response_card", () => {
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "Assistant response",
            text: "Assistant response",
            activity: { reasoningSummary: "Checked the code.", tools: [] },
            status: "complete"
          }
        ]
      })
    );

    const activityDisclosure = screen.getByText("Activity").closest("details");
    const assistantResponse = screen.getByText("Assistant response").closest("article");

    expect(activityDisclosure?.classList.contains("activity-disclosure")).toBe(true);
    expect(assistantResponse?.classList.contains("assistant-response")).toBe(true);
    expect(activityDisclosure?.parentElement).toBe(assistantResponse?.parentElement);
    expect(activityDisclosure?.nextElementSibling).toBe(assistantResponse);
  });

  it("renders_reasoning_summary_when_activity_is_expanded", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "",
            text: "",
            activity: { reasoningSummary: "Checked the code.", tools: [] },
            status: "streaming"
          }
        ]
      })
    );

    await user.click(screen.getByText("Activity"));

    expect(screen.getByText("Reasoning")).not.toBeNull();
    expect(screen.getByText("Checked the code.")).not.toBeNull();
  });

  it("renders_tool_activity_grouped_without_actions_title_labels_or_completion_state", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [assistantTurnWithWebSearchActivity()]
      })
    );

    await user.click(screen.getByText("Activity"));

    expect(screen.getByText("Searched web 2 times")).not.toBeNull();
    expect(screen.getByText("infobae lorena maciel tato young")).not.toBeNull();
    expect(screen.getByText("site:infobae.com/teleshow lorena maciel")).not.toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
    expect(screen.queryByText("Query")).toBeNull();
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("renders_command_output_under_the_matching_command_action", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [assistantTurnWithToolActivity("started", [{ stream: "stdout", text: "PASS tests" }])]
      })
    );

    await user.click(screen.getByText("Activity"));

    expect(screen.getByText("PASS tests")).not.toBeNull();
  });

  it("does_not_show_tool_completion_state_when_available", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [assistantTurnWithToolActivity("completed")]
      })
    );

    await user.click(screen.getByText("Activity"));

    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("does_not_render_progress_kind_pills_or_working_labels", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(
      snapshotForPage({
        transcript: [
          {
            kind: "assistant_turn",
            role: "assistant",
            markdown: "",
            text: "",
            activity: { reasoningSummary: "Checked the code.", tools: [] },
            status: "streaming"
          }
        ]
      })
    );

    await user.click(screen.getByText("Activity"));

    expect(screen.queryByText("progress")).toBeNull();
    expect(screen.queryByText("Working")).toBeNull();
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
            activity: { reasoningSummary: "", tools: [] },
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

describe("SidePanelView send mode UI", () => {
  it("renders_capture_send_button_when_send_mode_is_capture", () => {
    renderInteractiveSnapshot(snapshotForPage({ sendMode: "capture" }));

    expect(screen.getByRole("button", { name: "Capture + Send" })).not.toBeNull();
  });

  it("renders_send_button_when_send_mode_is_send", () => {
    renderInteractiveSnapshot(snapshotForPage({ sendMode: "send" }));

    expect(screen.getByRole("button", { name: "Send" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Capture + Send" })).toBeNull();
  });

  it("clicking_split_button_main_action_in_capture_mode_calls_onCaptureAndSend", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    const onSendPrompt = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "  summarize  ", sendMode: "capture" }), {
      onCaptureAndSend,
      onSendPrompt
    });

    await user.click(screen.getByRole("button", { name: "Capture + Send" }));

    expect(onCaptureAndSend).toHaveBeenCalledWith("summarize");
    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it("clicking_split_button_main_action_in_send_mode_calls_onSendPrompt", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    const onSendPrompt = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "  follow up  ", sendMode: "send" }), {
      onCaptureAndSend,
      onSendPrompt
    });

    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSendPrompt).toHaveBeenCalledWith("follow up");
    expect(onCaptureAndSend).not.toHaveBeenCalled();
  });

  it("pressing_enter_in_send_mode_calls_onSendPrompt", async () => {
    const user = userEvent.setup();
    const onCaptureAndSend = vi.fn(() => true);
    const onSendPrompt = vi.fn(() => true);
    renderInteractiveSnapshot(snapshotForPage({ draftPrompt: "follow up", sendMode: "send" }), {
      onCaptureAndSend,
      onSendPrompt
    });

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Enter}");

    expect(onSendPrompt).toHaveBeenCalledWith("follow up");
    expect(onCaptureAndSend).not.toHaveBeenCalled();
  });

  it("split_button_arrow_opens_send_mode_menu", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(snapshotForPage());

    await user.click(screen.getByRole("button", { name: "Choose send mode" }));

    const sendModeGroup = screen.getByRole("group", { name: "Send mode" });
    expect(sendModeGroup).not.toBeNull();
    expect(screen.getByRole("button", { name: "Capture + Send", pressed: true })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send", pressed: false })).not.toBeNull();
  });

  it("selecting_capture_send_in_split_button_menu_calls_onSendModeChange", async () => {
    const user = userEvent.setup();
    const onSendModeChange = vi.fn();
    renderInteractiveSnapshot(snapshotForPage({ sendMode: "send" }), { onSendModeChange });

    await user.click(screen.getByRole("button", { name: "Choose send mode" }));
    await user.click(screen.getByRole("button", { name: "Capture + Send" }));

    expect(onSendModeChange).toHaveBeenCalledWith("capture");
    expect(screen.getByRole("button", { name: "Capture + Send" })).not.toBeNull();
  });

  it("selecting_send_in_split_button_menu_calls_onSendModeChange", async () => {
    const user = userEvent.setup();
    const onSendModeChange = vi.fn();
    renderInteractiveSnapshot(snapshotForPage({ sendMode: "capture" }), { onSendModeChange });

    await user.click(screen.getByRole("button", { name: "Choose send mode" }));
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSendModeChange).toHaveBeenCalledWith("send");
    expect(screen.getByRole("button", { name: "Send" })).not.toBeNull();
  });

  it("split_button_menu_controls_are_disabled_while_prompt_controls_are_disabled", () => {
    renderInteractiveSnapshot(snapshotForUnsupportedPage());

    expect(screen.getByRole("button", { name: "Capture + Send" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Choose send mode" })).toHaveProperty("disabled", true);
  });

  it("prompt_options_keep_send_full_dom_without_send_mode_controls", async () => {
    const user = userEvent.setup();
    renderInteractiveSnapshot(snapshotForPage());

    await user.click(screen.getByRole("button", { name: "Prompt options" }));

    expect(screen.getByRole("checkbox", { name: "Send Full DOM" })).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Send mode" })).toBeNull();
  });
});

describe("SidePanelView prompt options", () => {
  describe("interaction affordances", () => {
    it("adds_title_affordances_to_icon_only_header_buttons", () => {
      renderInteractiveSnapshot(snapshotForPage());

      expect(screen.getByRole("button", { name: "Settings" }).getAttribute("title")).toBe("Settings");
      expect(screen.getByRole("button", { name: "New chat" }).getAttribute("title")).toBe("New chat");
    });

    it("adds_title_affordance_to_prompt_options_button", () => {
      renderInteractiveSnapshot(snapshotForPage());

      expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("title")).toBe("Prompt options");
    });

    it("marks_prompt_options_button_open_for_visual_state_when_expanded", async () => {
      const user = userEvent.setup();
      renderInteractiveSnapshot(snapshotForPage());

      await user.click(screen.getByRole("button", { name: "Prompt options" }));

      expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("data-state")).toBe("open");
    });

    it("does_not_mark_prompt_options_button_open_after_closing", async () => {
      const user = userEvent.setup();
      renderInteractiveSnapshot(snapshotForPage());

      await user.click(screen.getByRole("button", { name: "Prompt options" }));
      await user.click(screen.getByRole("button", { name: "Prompt options" }));

      expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("data-state")).toBe("closed");
    });
  });

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
        onSendModeChange={() => undefined}
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
        onSendModeChange={() => undefined}
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
        onSendModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(screen.queryByRole("checkbox", { name: "Send Full DOM" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prompt options" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("data-state")).toBe("closed");
  });

  it("renders_prompt_options_button_closed_immediately_when_disabled_while_open", () => {
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
        onSendModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Prompt options" }));
    expect(screen.getByRole("button", { name: "Prompt options" }).getAttribute("data-state")).toBe("open");

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
        onSendModeChange={() => undefined}
        onNewChat={() => undefined}
        onRetryBridge={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    const promptOptionsButton = screen.getByRole("button", { name: "Prompt options" });
    expect(promptOptionsButton).toHaveProperty("disabled", true);
    expect(promptOptionsButton.getAttribute("aria-expanded")).toBe("false");
    expect(promptOptionsButton.getAttribute("data-state")).toBe("closed");
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
