export const SIDRA_SIDE_PANEL_PATH = "side-panel.html";
export const NO_FOCUSED_CHROME_WINDOW_ID = -1;

export type SidePanelOpenState = {
  tabId?: number;
  path?: string;
  enabled?: boolean;
};

export type SidePanelTab = {
  id?: number;
};

export type SidePanelWindowFocus = {
  windowId: number;
};

export type SidePanelTabActivation = {
  tabId: number;
  windowId: number;
};

export type SidePanelEventListener<T> = (event: T) => void | Promise<void>;

export type SidePanelGateway = {
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  setOptions(options: SidePanelOpenState): Promise<void>;
  getActiveTabs(): Promise<SidePanelTab[]>;
  getActiveTabInWindow(windowId: number): Promise<SidePanelTab | undefined>;
  onTabActivated(listener: SidePanelEventListener<SidePanelTabActivation>): () => void;
  onWindowFocused(listener: SidePanelEventListener<SidePanelWindowFocus>): () => void;
  onTabReplaced(listener: (addedTabId: number, removedTabId: number) => void | Promise<void>): () => void;
};

export type SidePanelTabVisibilityController = {
  start(): void;
  stop(): void;
};

export type SidePanelErrorReporter = (error: unknown) => void;

export function createSidePanelTabVisibilityController(options: {
  gateway: SidePanelGateway;
  reportError?: SidePanelErrorReporter;
}): SidePanelTabVisibilityController {
  return new DefaultSidePanelTabVisibilityController(options.gateway, options.reportError ?? reportSidePanelError);
}

export function createChromeSidePanelTabVisibilityController(): SidePanelTabVisibilityController {
  return createSidePanelTabVisibilityController({
    gateway: createChromeSidePanelGateway()
  });
}

class DefaultSidePanelTabVisibilityController implements SidePanelTabVisibilityController {
  private readonly gateway: SidePanelGateway;
  private readonly reportError: SidePanelErrorReporter;
  private unsubscribeCallbacks: Array<() => void> = [];

  constructor(gateway: SidePanelGateway, reportError: SidePanelErrorReporter) {
    this.gateway = gateway;
    this.reportError = reportError;
  }

  start(): void {
    if (this.unsubscribeCallbacks.length > 0) return;

    this.runBrowserTask(this.gateway.setPanelBehavior({ openPanelOnActionClick: true }));
    this.runBrowserTask(this.enableActiveTabs());
    this.unsubscribeCallbacks = [
      this.gateway.onTabActivated((info) => this.runBrowserTask(this.enableTab(info.tabId))),
      this.gateway.onWindowFocused((info) => this.runBrowserTask(this.enableFocusedWindowTab(info.windowId))),
      this.gateway.onTabReplaced((addedTabId) => this.runBrowserTask(this.enableTab(addedTabId)))
    ];
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribeCallbacks) unsubscribe();
    this.unsubscribeCallbacks = [];
  }

  private async enableActiveTabs(): Promise<void> {
    const activeTabs = await this.gateway.getActiveTabs();
    await Promise.all(activeTabs.map((tab) => this.enableTab(tab.id)));
  }

  private async enableFocusedWindowTab(windowId: number): Promise<void> {
    if (!isFocusedWindowId(windowId)) return;

    const activeTab = await this.gateway.getActiveTabInWindow(windowId);
    await this.enableTab(activeTab?.id);
  }

  private async enableTab(tabId: number | undefined): Promise<void> {
    if (!isUsableTabId(tabId)) return;

    await this.gateway.setOptions({ tabId, path: SIDRA_SIDE_PANEL_PATH, enabled: true });
  }

  private runBrowserTask(task: Promise<void>): void {
    void task.catch((error: unknown) => this.reportError(error));
  }
}

function createChromeSidePanelGateway(): SidePanelGateway {
  return {
    setPanelBehavior: (behavior) => chrome.sidePanel.setPanelBehavior(behavior),
    setOptions: (options) => chrome.sidePanel.setOptions(options),
    getActiveTabs() {
      return chrome.tabs.query({ active: true });
    },
    async getActiveTabInWindow(windowId) {
      return (await chrome.tabs.query({ active: true, windowId }))[0];
    },
    onTabActivated(listener) {
      const chromeListener = (info: chrome.tabs.TabActiveInfo) => {
        void listener(info);
      };
      chrome.tabs.onActivated.addListener(chromeListener);
      return () => chrome.tabs.onActivated.removeListener(chromeListener);
    },
    onWindowFocused(listener) {
      const chromeListener = (windowId: number) => {
        void listener({ windowId });
      };
      chrome.windows.onFocusChanged.addListener(chromeListener);
      return () => chrome.windows.onFocusChanged.removeListener(chromeListener);
    },
    onTabReplaced(listener) {
      const chromeListener = (addedTabId: number, removedTabId: number) => {
        void listener(addedTabId, removedTabId);
      };
      chrome.tabs.onReplaced.addListener(chromeListener);
      return () => chrome.tabs.onReplaced.removeListener(chromeListener);
    }
  };
}

function isUsableTabId(tabId: number | undefined): tabId is number {
  return typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0;
}

function isFocusedWindowId(windowId: number): boolean {
  return Number.isInteger(windowId) && windowId >= 0 && windowId !== NO_FOCUSED_CHROME_WINDOW_ID;
}

function reportSidePanelError(error: unknown): void {
  console.error("Sidra side panel visibility setup failed.", error);
}
