declare namespace chrome {
  namespace tabs {
    type Tab = {
      active?: boolean;
      id?: number;
      windowId?: number;
      url?: string;
      title?: string;
      favIconUrl?: string;
    };

    type QueryInfo = {
      active?: boolean;
      currentWindow?: boolean;
      windowId?: number;
    };

    type CaptureVisibleTabOptions = {
      format?: "jpeg" | "png";
      quality?: number;
    };

    type MessageSendOptions = {
      frameId?: number;
      documentId?: string;
    };

    type TabActiveInfo = {
      tabId: number;
      windowId: number;
    };

    type TabChangeInfo = {
      url?: string;
      title?: string;
      favIconUrl?: string;
    };

    function query(queryInfo: QueryInfo): Promise<Tab[]>;
    function sendMessage<T = unknown>(tabId: number, message: unknown, options?: MessageSendOptions): Promise<T>;
    function captureVisibleTab(windowId: number, options?: CaptureVisibleTabOptions): Promise<string>;

    const onActivated: {
      addListener(listener: (info: TabActiveInfo) => void): void;
      removeListener(listener: (info: TabActiveInfo) => void): void;
    };

    const onUpdated: {
      addListener(listener: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void): void;
      removeListener(listener: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void): void;
    };

    const onReplaced: {
      addListener(listener: (addedTabId: number, removedTabId: number) => void): void;
      removeListener(listener: (addedTabId: number, removedTabId: number) => void): void;
    };
  }

  namespace sidePanel {
    type PanelBehavior = {
      openPanelOnActionClick: boolean;
    };

    type Options = {
      tabId?: number;
      path?: string;
      enabled?: boolean;
    };

    function setPanelBehavior(behavior: PanelBehavior): Promise<void>;
    function setOptions(options: Options): Promise<void>;
  }

  namespace runtime {
    type Port = {
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(listener: (message: unknown) => void): void };
      onDisconnect: { addListener(listener: () => void): void };
    };

    type MessageSender = {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
    };

    function connectNative(application: string): Port;
    function openOptionsPage(): void;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;

    const onMessage: {
      addListener(
        listener: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void
      ): void;
      removeListener(
        listener: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void
      ): void;
    };
  }

  namespace scripting {
    type InjectionTarget = {
      tabId: number;
      allFrames?: boolean;
      frameIds?: number[];
    };

    type InjectionResult<T> = {
      frameId?: number;
      documentId?: string;
      result?: T;
    };

    type FunctionInjection<T> = {
      target: InjectionTarget;
      func: () => T;
    };

    type FileInjection = {
      target: InjectionTarget;
      files: string[];
    };

    function executeScript<T>(injection: FunctionInjection<T>): Promise<Array<InjectionResult<T>>>;
    function executeScript(injection: FileInjection): Promise<Array<InjectionResult<undefined>>>;
  }

  namespace storage {
    type AreaName = "local" | "sync" | "managed" | "session";

    type StorageChange = {
      oldValue?: unknown;
      newValue?: unknown;
    };

    type StorageArea = {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };

    const local: StorageArea;

    const onChanged: {
      addListener(listener: (changes: Record<string, StorageChange>, areaName: AreaName) => void): void;
      removeListener(listener: (changes: Record<string, StorageChange>, areaName: AreaName) => void): void;
    };
  }

  namespace windows {
    const WINDOW_ID_NONE: number;

    const onFocusChanged: {
      addListener(listener: (windowId: number) => void): void;
      removeListener(listener: (windowId: number) => void): void;
    };
  }
}
