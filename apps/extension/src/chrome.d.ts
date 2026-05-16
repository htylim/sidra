declare namespace chrome {
  namespace tabs {
    type Tab = {
      id?: number;
      windowId?: number;
      url?: string;
      title?: string;
    };

    type QueryInfo = {
      active?: boolean;
      currentWindow?: boolean;
    };

    type TabActiveInfo = {
      tabId: number;
      windowId: number;
    };

    type TabChangeInfo = {
      url?: string;
      title?: string;
    };

    function query(queryInfo: QueryInfo): Promise<Tab[]>;

    const onActivated: {
      addListener(listener: (info: TabActiveInfo) => void): void;
      removeListener(listener: (info: TabActiveInfo) => void): void;
    };

    const onUpdated: {
      addListener(listener: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void): void;
      removeListener(listener: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void): void;
    };
  }

  namespace runtime {
    type Port = {
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(listener: (message: unknown) => void): void };
      onDisconnect: { addListener(listener: () => void): void };
    };

    function connectNative(application: string): Port;
  }

  namespace scripting {
    type InjectionTarget = {
      tabId: number;
    };

    type InjectionResult<T> = {
      result?: T;
    };

    type ScriptInjection<T> = {
      target: InjectionTarget;
      func: () => T;
    };

    function executeScript<T>(injection: ScriptInjection<T>): Promise<Array<InjectionResult<T>>>;
  }

  namespace windows {
    const WINDOW_ID_NONE: number;

    const onFocusChanged: {
      addListener(listener: (windowId: number) => void): void;
      removeListener(listener: (windowId: number) => void): void;
    };
  }
}
