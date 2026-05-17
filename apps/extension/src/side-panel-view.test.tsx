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
  contextLabel?: string;
  contextState?: SidePanelSnapshot["activeSession"]["contextState"];
  captureMode?: SidePanelSnapshot["activeSession"]["captureMode"];
  draftPrompt?: string;
  transcript?: SidePanelSnapshot["activeSession"]["transcript"];
  quickActions?: SidePanelSnapshot["activeSession"]["quickActions"];
};

function snapshotForPage(options: SnapshotOptions = {}): SidePanelSnapshot {
  return {
    bridge: readyBridge,
    activePage: {
      status: "ready",
      pageKey: "https://example.com/article" as PageKey,
      url: "https://example.com/article",
      displayTitle: options.title ?? "Example Article"
    },
    activeSession: {
      pageKey: "https://example.com/article" as SidePanelSnapshot["activeSession"]["pageKey"],
      clientSessionId: "client-1",
      captureMode: options.captureMode ?? "readable",
      draftPrompt: options.draftPrompt ?? "",
      contextState: options.contextState ?? { status: "none", label: "No context sent yet" },
      transcript: options.transcript ?? [],
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: false,
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
  onDraftPromptChange(text: string): void;
  onCaptureModeChange(captureMode: SidePanelSnapshot["activeSession"]["captureMode"]): void;
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
        onNewChat={() => undefined}
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
        onNewChat={() => undefined}
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
        transcript: [{ role: "user", text: "hello" }]
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
        transcript: [{ role: "user", text: "active page text" }]
      })
    );
    expect(markup).toContain("active page text");
    expect(markup).not.toContain("inactive page text");
  });

  it("keeps_empty_state_scoped_to_the_active_session", () => {
    const markup = renderPageSnapshot(snapshotForPage({ transcript: [] }));
    expect(markup).toContain("Ask anything about this page");
  });
});

describe("SidePanelView Capture + Send", () => {
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
          { role: "status", text: "Page context attached" },
          { role: "user", text: "summarize" }
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
