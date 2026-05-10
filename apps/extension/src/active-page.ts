import { resolvePageIdentity, type PageIdentity } from "./page-key";

export type ActivePageTab = {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
};

export type ActivePageGateway = {
  queryActiveTab(): Promise<ActivePageTab | undefined>;
  onActivated(listener: (info: { tabId: number; windowId: number }) => void): () => void;
  onUpdated(listener: (tabId: number, changeInfo: { url?: string; title?: string }) => void): () => void;
  onWindowFocusChanged?(listener: (windowId: number) => void): () => void;
};

type ActivePageTrackerOptions = {
  gateway: ActivePageGateway;
};

type Listener = () => void;

export class ActivePageTracker {
  private readonly gateway: ActivePageGateway;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeCallbacks: Array<() => void> = [];
  private snapshot: PageIdentity = { status: "unsupported", reason: "missing_url" };
  private activeTabId?: number;
  private latestRefreshRequest = 0;

  constructor(options: ActivePageTrackerOptions) {
    this.gateway = options.gateway;
    this.subscribeToGateway();
  }

  getSnapshot(): PageIdentity {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const requestNumber = this.latestRefreshRequest + 1;
    this.latestRefreshRequest = requestNumber;
    let activeTab: ActivePageTab | undefined;

    try {
      activeTab = await this.gateway.queryActiveTab();
    } catch {
      if (requestNumber !== this.latestRefreshRequest) return;
      this.activeTabId = undefined;
      this.setSnapshot({ status: "unsupported", reason: "active_tab_unavailable" });
      return;
    }

    if (requestNumber !== this.latestRefreshRequest) return;

    this.activeTabId = activeTab?.id;
    this.setSnapshot(
      resolvePageIdentity({
        url: activeTab?.url,
        title: activeTab?.title
      })
    );
  }

  stop(): void {
    while (this.unsubscribeCallbacks.length > 0) {
      this.unsubscribeCallbacks.pop()?.();
    }
  }

  private subscribeToGateway(): void {
    this.unsubscribeCallbacks.push(
      this.gateway.onActivated(() => {
        void this.refresh();
      })
    );
    this.unsubscribeCallbacks.push(
      this.gateway.onUpdated((tabId, changeInfo) => {
        const activeTabChanged = this.activeTabId === undefined || tabId === this.activeTabId;
        if (activeTabChanged && (changeInfo.url !== undefined || changeInfo.title !== undefined)) {
          void this.refresh();
        }
      })
    );
    if (this.gateway.onWindowFocusChanged) {
      this.unsubscribeCallbacks.push(
        this.gateway.onWindowFocusChanged(() => {
          void this.refresh();
        })
      );
    }
  }

  private setSnapshot(snapshot: PageIdentity): void {
    this.snapshot = snapshot;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createChromeActivePageTracker(): ActivePageTracker {
  return new ActivePageTracker({ gateway: createChromeActivePageGateway() });
}

function createChromeActivePageGateway(): ActivePageGateway {
  return {
    async queryActiveTab() {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return activeTab;
    },
    onActivated(listener) {
      chrome.tabs.onActivated.addListener(listener);
      return () => chrome.tabs.onActivated.removeListener(listener);
    },
    onUpdated(listener) {
      chrome.tabs.onUpdated.addListener(listener);
      return () => chrome.tabs.onUpdated.removeListener(listener);
    },
    onWindowFocusChanged(listener) {
      chrome.windows.onFocusChanged.addListener(listener);
      return () => chrome.windows.onFocusChanged.removeListener(listener);
    }
  };
}
