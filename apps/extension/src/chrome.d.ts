declare namespace chrome {
  namespace runtime {
    type Port = {
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(listener: (message: unknown) => void): void };
      onDisconnect: { addListener(listener: () => void): void };
    };

    function connectNative(application: string): Port;
  }
}
