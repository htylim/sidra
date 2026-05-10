import { describe, expect, it, vi } from "vitest";
import { ActivePageTracker, type ActivePageGateway, type ActivePageTab } from "./active-page";

type ActivatedTabInput = { tabId: number; windowId: number; url?: string; title?: string };

class FakeActivePageGateway implements ActivePageGateway {
  readonly queryActiveTab = vi.fn(async () => this.activeTab);
  private readonly activatedListeners = new Set<(info: { tabId: number; windowId: number }) => void>();
  private readonly updatedListeners = new Set<
    (tabId: number, changeInfo: { url?: string; title?: string }) => void
  >();
  private readonly tabsById = new Map<number, ActivePageTab>();
  private activeTab?: ActivePageTab;

  constructor(activeTab?: ActivePageTab) {
    if (activeTab) this.setActiveTab(activeTab);
  }

  onActivated(listener: (info: { tabId: number; windowId: number }) => void): () => void {
    this.activatedListeners.add(listener);
    return () => this.activatedListeners.delete(listener);
  }

  onUpdated(listener: (tabId: number, changeInfo: { url?: string; title?: string }) => void): () => void {
    this.updatedListeners.add(listener);
    return () => this.updatedListeners.delete(listener);
  }

  async emitActivated(input: ActivatedTabInput): Promise<void> {
    this.setActiveTab({ id: input.tabId, windowId: input.windowId, url: input.url, title: input.title });
    for (const listener of this.activatedListeners) listener({ tabId: input.tabId, windowId: input.windowId });
    await Promise.resolve();
  }

  async emitUpdated(tabId: number, changeInfo: { url?: string; title?: string }): Promise<void> {
    const currentTab = this.tabsById.get(tabId) ?? { id: tabId, windowId: 1 };
    const nextTab = { ...currentTab, ...changeInfo };
    this.tabsById.set(tabId, nextTab);
    if (this.activeTab?.id === tabId) this.activeTab = nextTab;
    for (const listener of this.updatedListeners) listener(tabId, changeInfo);
    await Promise.resolve();
  }

  private setActiveTab(tab: ActivePageTab): void {
    this.activeTab = tab;
    if (tab.id !== undefined) this.tabsById.set(tab.id, tab);
  }
}

class DeferredActivePageGateway implements ActivePageGateway {
  private readonly pendingReads: Array<{
    resolve: (tab: ActivePageTab | undefined) => void;
    reject: (error: unknown) => void;
  }> = [];

  queryActiveTab = vi.fn(
    () =>
      new Promise<ActivePageTab | undefined>((resolve, reject) => {
        this.pendingReads.push({ resolve, reject });
      })
  );

  onActivated(_listener: (info: { tabId: number; windowId: number }) => void): () => void {
    return () => undefined;
  }

  onUpdated(_listener: (tabId: number, changeInfo: { url?: string; title?: string }) => void): () => void {
    return () => undefined;
  }

  resolveRead(readNumber: number, tab: ActivePageTab): void {
    const pendingRead = this.pendingReads[readNumber - 1];
    if (!pendingRead) throw new Error(`missing pending read ${readNumber}`);
    pendingRead.resolve(tab);
  }

  rejectRead(readNumber: number, error: unknown): void {
    const pendingRead = this.pendingReads[readNumber - 1];
    if (!pendingRead) throw new Error(`missing pending read ${readNumber}`);
    pendingRead.reject(error);
  }
}

function createActivePageHarness(options: { activeTab?: ActivePageTab; activeTabId?: number } = {}) {
  const activeTab =
    options.activeTab ??
    (options.activeTabId
      ? { id: options.activeTabId, windowId: 1, url: "https://example.com/a" }
      : undefined);
  const gateway = new FakeActivePageGateway(activeTab);
  const tracker = new ActivePageTracker({ gateway });
  return { gateway, tracker };
}

function createDeferredActivePageHarness() {
  const gateway = new DeferredActivePageGateway();
  const tracker = new ActivePageTracker({ gateway });
  return { gateway, tracker };
}

describe("ActivePageTracker", () => {
  it("reads_initial_active_tab_from_current_window", async () => {
    const harness = createActivePageHarness({
      activeTab: { id: 1, windowId: 1, url: "https://example.com/a", title: "Page A" }
    });
    await harness.tracker.start();
    expect(harness.gateway.queryActiveTab).toHaveBeenCalledOnce();
    expect(harness.tracker.getSnapshot()).toMatchObject({ status: "ready", displayTitle: "Page A" });
  });

  it("emits_page_change_on_tab_activation", async () => {
    const harness = createActivePageHarness();
    const listener = vi.fn();
    harness.tracker.subscribe(listener);
    await harness.gateway.emitActivated({ tabId: 2, windowId: 1, url: "https://example.com/b" });
    expect(listener).toHaveBeenCalled();
    expect(harness.tracker.getSnapshot()).toMatchObject({ status: "ready", url: "https://example.com/b" });
  });

  it("emits_page_change_when_active_tab_url_changes", async () => {
    const harness = createActivePageHarness({ activeTabId: 1 });
    await harness.gateway.emitUpdated(1, { url: "https://example.com/changed", title: "Changed" });
    expect(harness.tracker.getSnapshot()).toMatchObject({ status: "ready", displayTitle: "Changed" });
  });

  it("ignores_stale_active_tab_queries_that_resolve_out_of_order", async () => {
    const harness = createDeferredActivePageHarness();
    const firstRead = harness.tracker.refresh();
    const secondRead = harness.tracker.refresh();
    harness.gateway.resolveRead(2, { url: "https://example.com/newer" });
    harness.gateway.resolveRead(1, { url: "https://example.com/stale" });
    await Promise.all([firstRead, secondRead]);
    expect(harness.tracker.getSnapshot()).toMatchObject({ status: "ready", url: "https://example.com/newer" });
  });

  it("reports_unsupported_page_without_reusing_the_previous_page_session", async () => {
    const harness = createActivePageHarness({ activeTab: { id: 1, windowId: 1, url: "https://example.com/a" } });
    await harness.tracker.start();
    await harness.gateway.emitUpdated(1, { url: "chrome://extensions" });
    expect(harness.tracker.getSnapshot()).toMatchObject({ status: "unsupported", reason: "unsupported_url" });
  });

  it("reports_active_tab_read_failures_without_rejecting_refresh", async () => {
    const harness = createDeferredActivePageHarness();
    const refresh = harness.tracker.refresh();
    harness.gateway.rejectRead(1, new Error("tabs unavailable"));
    await expect(refresh).resolves.toBeUndefined();
    expect(harness.tracker.getSnapshot()).toMatchObject({
      status: "unsupported",
      reason: "active_tab_unavailable"
    });
  });
});
