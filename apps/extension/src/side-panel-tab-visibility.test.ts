import { describe, expect, it } from "vitest";
import {
  NO_FOCUSED_CHROME_WINDOW_ID,
  SIDRA_SIDE_PANEL_PATH,
  createSidePanelTabVisibilityController,
  type SidePanelGateway,
  type SidePanelOpenState,
  type SidePanelTab,
  type SidePanelTabActivation,
  type SidePanelWindowFocus
} from "./side-panel-tab-visibility";

describe("SidePanelTabVisibilityController tab-specific side panel availability", () => {
  it("configures_the_toolbar_action_to_use_chrome_native_side_panel_toggle", async () => {
    const gateway = new FakeSidePanelGateway();
    const controller = createSidePanelTabVisibilityController({ gateway });

    controller.start();
    await flushAsyncListeners();

    expect(gateway.calls[0]).toEqual({
      name: "setPanelBehavior",
      behavior: { openPanelOnActionClick: true }
    });
  });

  it("enables_the_current_active_tab_on_start", async () => {
    const gateway = new FakeSidePanelGateway();
    gateway.activeTabs = [{ id: 12 }];
    const controller = createSidePanelTabVisibilityController({ gateway });

    controller.start();
    await flushAsyncListeners();

    expect(gateway.optionsForTab(12)).toEqual({ tabId: 12, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
    expect(gateway.calls).toEqual([
      { name: "setPanelBehavior", behavior: { openPanelOnActionClick: true } },
      { name: "getActiveTabs" },
      { name: "setOptions", options: { tabId: 12, path: SIDRA_SIDE_PANEL_PATH, enabled: true } }
    ]);
  });

  it("enables_active_tabs_in_each_open_window_on_start", async () => {
    const gateway = new FakeSidePanelGateway();
    gateway.activeTabs = [{ id: 12 }, { id: 34 }];
    const controller = createSidePanelTabVisibilityController({ gateway });

    controller.start();
    await flushAsyncListeners();

    expect(gateway.optionsForTab(12)).toEqual({ tabId: 12, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
    expect(gateway.optionsForTab(34)).toEqual({ tabId: 34, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
  });

  it("enables_the_active_tab_when_an_existing_window_gets_focus", async () => {
    const gateway = new FakeSidePanelGateway();
    gateway.setActiveTabForWindow(200, { id: 34 });
    const controller = createSidePanelTabVisibilityController({ gateway });
    controller.start();
    await flushAsyncListeners();

    await gateway.emitWindowFocused({ windowId: 200 });

    expect(gateway.calls).toContainEqual({ name: "getActiveTabInWindow", windowId: 200 });
    expect(gateway.optionsForTab(34)).toEqual({ tabId: 34, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
  });

  it("ignores_focus_events_without_a_browser_window", async () => {
    const gateway = new FakeSidePanelGateway();
    const controller = createSidePanelTabVisibilityController({ gateway });
    controller.start();
    await flushAsyncListeners();

    await gateway.emitWindowFocused({ windowId: NO_FOCUSED_CHROME_WINDOW_ID });

    expect(gateway.calls.filter((call) => call.name === "getActiveTabInWindow")).toEqual([]);
  });

  it("enables_each_activated_tab_without_tracking_urls", async () => {
    const gateway = new FakeSidePanelGateway();
    const controller = createSidePanelTabVisibilityController({ gateway });
    controller.start();
    await flushAsyncListeners();

    await gateway.emitTabActivated({ tabId: 1, windowId: 100 });
    await gateway.emitTabActivated({ tabId: 2, windowId: 100 });
    gateway.emitTabUpdated(2, { url: "https://example.test/next" });

    expect(gateway.optionsForTab(1)).toEqual({ tabId: 1, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
    expect(gateway.optionsForTab(2)).toEqual({ tabId: 2, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
    expect(gateway.calls.filter((call) => call.name === "setOptions")).toEqual([
      { name: "setOptions", options: { tabId: 1, path: SIDRA_SIDE_PANEL_PATH, enabled: true } },
      { name: "setOptions", options: { tabId: 2, path: SIDRA_SIDE_PANEL_PATH, enabled: true } }
    ]);
  });

  it("enables_the_added_tab_after_tab_replacement", async () => {
    const gateway = new FakeSidePanelGateway();
    const controller = createSidePanelTabVisibilityController({ gateway });
    controller.start();
    await flushAsyncListeners();

    await gateway.emitTabReplaced(21, 20);

    expect(gateway.optionsForTab(21)).toEqual({ tabId: 21, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
    expect(gateway.optionsForTab(20).enabled).toBe(false);
  });

  it("ignores_tabs_without_usable_ids", async () => {
    const gateway = new FakeSidePanelGateway();
    gateway.activeTabs = [{}];
    const controller = createSidePanelTabVisibilityController({ gateway });

    controller.start();
    await flushAsyncListeners();
    await gateway.emitTabActivated({ tabId: -1, windowId: 100 });

    expect(gateway.calls.filter((call) => call.name === "setOptions")).toEqual([]);
  });

  it("does_not_register_duplicate_listeners_when_started_twice", async () => {
    const gateway = new FakeSidePanelGateway();
    const controller = createSidePanelTabVisibilityController({ gateway });

    controller.start();
    controller.start();
    await gateway.emitTabActivated({ tabId: 7, windowId: 100 });

    expect(gateway.calls.filter((call) => call.name === "setPanelBehavior")).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.name === "setOptions")).toEqual([
      { name: "setOptions", options: { tabId: 7, path: SIDRA_SIDE_PANEL_PATH, enabled: true } }
    ]);
  });

  it("stops_listening_to_tab_lifecycle_events", async () => {
    const gateway = new FakeSidePanelGateway();
    const controller = createSidePanelTabVisibilityController({ gateway });
    controller.start();
    controller.stop();

    await gateway.emitTabActivated({ tabId: 7, windowId: 100 });
    await gateway.emitTabReplaced(8, 7);
    await gateway.emitWindowFocused({ windowId: 100 });

    expect(gateway.calls.filter((call) => call.name === "setOptions")).toEqual([]);
  });

  it("reports_browser_api_failures_without_leaking_rejected_promises", async () => {
    const gateway = new FakeSidePanelGateway();
    const behaviorError = new Error("panel behavior failed");
    const activeTabError = new Error("active tab lookup failed");
    const focusedWindowError = new Error("focused window lookup failed");
    const setOptionsError = new Error("tab options failed");
    const reportedErrors: unknown[] = [];
    gateway.setPanelBehaviorError = behaviorError;
    gateway.getActiveTabsError = activeTabError;
    gateway.getActiveTabInWindowError = focusedWindowError;
    gateway.setOptionsError = setOptionsError;
    const controller = createSidePanelTabVisibilityController({
      gateway,
      reportError: (error) => reportedErrors.push(error)
    });

    controller.start();
    await flushAsyncListeners();
    await gateway.emitWindowFocused({ windowId: 100 });
    await flushAsyncListeners();
    await gateway.emitTabActivated({ tabId: 7, windowId: 100 });
    await flushAsyncListeners();

    expect(reportedErrors).toEqual([behaviorError, activeTabError, focusedWindowError, setOptionsError]);
  });
});

type FakeCall =
  | { name: "setPanelBehavior"; behavior: { openPanelOnActionClick: boolean } }
  | { name: "setOptions"; options: SidePanelOpenState }
  | { name: "getActiveTabs" }
  | { name: "getActiveTabInWindow"; windowId: number };

class FakeSidePanelGateway implements SidePanelGateway {
  activeTabs: SidePanelTab[] = [];
  getActiveTabsError: Error | undefined;
  getActiveTabInWindowError: Error | undefined;
  setOptionsError: Error | undefined;
  setPanelBehaviorError: Error | undefined;
  readonly calls: FakeCall[] = [];
  private readonly tabOptions = new Map<number, SidePanelOpenState>();
  private readonly activeTabsByWindowId = new Map<number, SidePanelTab>();
  private readonly tabActivatedListeners = new Set<(info: SidePanelTabActivation) => void | Promise<void>>();
  private readonly windowFocusedListeners = new Set<(info: SidePanelWindowFocus) => void | Promise<void>>();
  private readonly tabReplacedListeners = new Set<(addedTabId: number, removedTabId: number) => void | Promise<void>>();

  async setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> {
    this.calls.push({ name: "setPanelBehavior", behavior });
    if (this.setPanelBehaviorError) throw this.setPanelBehaviorError;
  }

  async setOptions(options: SidePanelOpenState): Promise<void> {
    this.calls.push({ name: "setOptions", options });
    if (this.setOptionsError) throw this.setOptionsError;
    if (options.tabId === undefined) return;
    const currentOptions = this.optionsForTab(options.tabId);
    this.tabOptions.set(options.tabId, { ...currentOptions, ...options });
  }

  async getActiveTabs(): Promise<SidePanelTab[]> {
    this.calls.push({ name: "getActiveTabs" });
    if (this.getActiveTabsError) throw this.getActiveTabsError;
    return this.activeTabs;
  }

  async getActiveTabInWindow(windowId: number): Promise<SidePanelTab | undefined> {
    this.calls.push({ name: "getActiveTabInWindow", windowId });
    if (this.getActiveTabInWindowError) throw this.getActiveTabInWindowError;
    return this.activeTabsByWindowId.get(windowId);
  }

  onTabActivated(listener: (info: SidePanelTabActivation) => void | Promise<void>): () => void {
    this.tabActivatedListeners.add(listener);
    return () => {
      this.tabActivatedListeners.delete(listener);
    };
  }

  onWindowFocused(listener: (info: SidePanelWindowFocus) => void | Promise<void>): () => void {
    this.windowFocusedListeners.add(listener);
    return () => {
      this.windowFocusedListeners.delete(listener);
    };
  }

  onTabReplaced(listener: (addedTabId: number, removedTabId: number) => void | Promise<void>): () => void {
    this.tabReplacedListeners.add(listener);
    return () => {
      this.tabReplacedListeners.delete(listener);
    };
  }

  optionsForTab(tabId: number): SidePanelOpenState {
    return { tabId, enabled: false, ...this.tabOptions.get(tabId) };
  }

  setActiveTabForWindow(windowId: number, tab: SidePanelTab): void {
    this.activeTabsByWindowId.set(windowId, tab);
  }

  async emitTabActivated(info: SidePanelTabActivation): Promise<void> {
    await Promise.all(Array.from(this.tabActivatedListeners, (listener) => listener(info)));
  }

  async emitWindowFocused(info: SidePanelWindowFocus): Promise<void> {
    await Promise.all(Array.from(this.windowFocusedListeners, (listener) => listener(info)));
  }

  async emitTabReplaced(addedTabId: number, removedTabId: number): Promise<void> {
    await Promise.all(Array.from(this.tabReplacedListeners, (listener) => listener(addedTabId, removedTabId)));
  }

  emitTabUpdated(_tabId: number, _changeInfo: { url?: string }): void {
    return undefined;
  }
}

async function flushAsyncListeners(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
