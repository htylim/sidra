import type {
  PageContextCaptureProof,
  PageContextRect,
  PageContextSelectionGeometry,
  PageContextViewport
} from "@sidra/protocol";

export type PageSelectionMode = "text" | "snapshot";

export type PageSelectionStartMessage = {
  type: "sidra.pageSelection.start";
  requestId: string;
  mode: PageSelectionMode;
  topFrame: boolean;
  tabId?: number;
  windowId?: number;
};

export type PageSelectionCancelMessage = {
  type: "sidra.pageSelection.cancel";
  requestId: string;
};

export type PageSelectionViewportProofMessage = {
  type: "sidra.pageSelection.readViewportProof";
  requestId: string;
  tabId?: number;
  windowId?: number;
};

export type PageSelectionContentMessage =
  | PageSelectionStartMessage
  | PageSelectionCancelMessage
  | PageSelectionViewportProofMessage;

export type PageSelectionContentResponse =
  | {
      status: "selected_text";
      requestId: string;
      frameDocumentUrl: string;
      text: string;
      selection: PageContextSelectionGeometry & { mode: "text_selection" };
    }
  | {
      status: "area_snapshot";
      requestId: string;
      frameDocumentUrl: string;
      selection: PageContextSelectionGeometry & { mode: "area_snapshot" };
    }
  | { status: "viewport_proof"; requestId: string; proof: PageContextCaptureProof }
  | { status: "empty_text"; requestId: string }
  | { status: "snapshot_too_small"; requestId: string }
  | { status: "cancelled"; requestId: string }
  | { status: "ignored"; requestId: string };

type ActiveSelection = {
  requestId: string;
  mode: PageSelectionMode;
  tabId?: number;
  windowId?: number;
  promise: Promise<PageSelectionContentResponse>;
  resolve(response: PageSelectionContentResponse): void;
};

const MIN_SNAPSHOT_SIZE_PX = 8;

export class PageSelectionContentController {
  private readonly document: Document;
  private readonly window: Window;
  private activeSelection?: ActiveSelection;
  private cleanupCallbacks: Array<() => void> = [];
  private snapshotCaptureLayerCleanupCallbacks: Array<() => void> = [];
  private overlayHost?: HTMLElement;
  private snapshotCaptureLayer?: HTMLElement;
  private snapshotStart?: { x: number; y: number };
  private snapshotRectElement?: HTMLElement;

  constructor(environment: { document?: Document; window?: Window } = {}) {
    this.document = environment.document ?? document;
    this.window = environment.window ?? window;
  }

  start(message: Omit<PageSelectionStartMessage, "type">): Promise<PageSelectionContentResponse> {
    if (this.activeSelection?.requestId === message.requestId) return this.activeSelection.promise;
    if (this.activeSelection) this.finish({ status: "cancelled", requestId: this.activeSelection.requestId });

    let resolveActive!: (response: PageSelectionContentResponse) => void;
    const promise = new Promise<PageSelectionContentResponse>((resolve) => {
      resolveActive = resolve;
    });
    this.activeSelection = {
      requestId: message.requestId,
      mode: message.mode,
      tabId: message.tabId,
      windowId: message.windowId,
      promise,
      resolve: resolveActive
    };

    if (message.topFrame) this.mountOverlay();
    this.switchMode(message.mode);
    this.addDocumentListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") this.cancel(message.requestId);
    });
    this.addDocumentListener("mouseup", (event) => this.handleTextMouseUp(event as MouseEvent));
    this.addDocumentListener("pointerdown", (event) => this.handleSnapshotPointerDown(event as PointerEvent));
    this.addDocumentListener("pointermove", (event) => this.handleSnapshotPointerMove(event as PointerEvent));
    this.addDocumentListener("pointerup", (event) => this.handleSnapshotPointerUp(event as PointerEvent));

    return promise;
  }

  cancel(requestId: string): PageSelectionContentResponse {
    if (!this.activeSelection || this.activeSelection.requestId !== requestId) {
      return { status: "cancelled", requestId };
    }
    const response = { status: "cancelled", requestId } as const;
    this.finish(response);
    return response;
  }

  readViewportProof(message: Omit<PageSelectionViewportProofMessage, "type">): PageSelectionContentResponse {
    return {
      status: "viewport_proof",
      requestId: message.requestId,
      proof: this.captureProof(message.requestId, message.tabId, message.windowId)
    };
  }

  private handleTextMouseUp(event: MouseEvent): void {
    if (this.eventStartedInOverlay(event)) return;
    const activeSelection = this.activeSelection;
    if (!activeSelection || activeSelection.mode !== "text") return;

    const text = this.document.getSelection()?.toString() ?? "";
    if (!text.trim()) {
      this.finish({ status: "empty_text", requestId: activeSelection.requestId });
      return;
    }

    const fallbackRect = { x: event.clientX, y: event.clientY, width: 1, height: 1 };
    const textRects = this.selectedTextRects();
    const boundingRect = unionRects(textRects) ?? fallbackRect;
    const selection = {
      mode: "text_selection" as const,
      viewport: this.currentViewport(),
      boundingRect,
      textRects: textRects.length > 0 ? textRects : [fallbackRect],
      captureProof: this.captureProof(activeSelection.requestId, activeSelection.tabId, activeSelection.windowId)
    };

    this.finish({
      status: "selected_text",
      requestId: activeSelection.requestId,
      frameDocumentUrl: this.window.location.href,
      text,
      selection
    });
  }

  private handleSnapshotPointerDown(event: PointerEvent, allowOverlayEvent = false): void {
    if (!allowOverlayEvent && this.eventStartedInOverlay(event)) return;
    const activeSelection = this.activeSelection;
    if (!activeSelection || activeSelection.mode !== "snapshot") return;
    event.preventDefault();
    this.snapshotStart = { x: event.clientX, y: event.clientY };
    this.updateSnapshotRect(event.clientX, event.clientY);
  }

  private handleSnapshotPointerMove(event: PointerEvent, allowOverlayEvent = false): void {
    if (!allowOverlayEvent && this.eventStartedInOverlay(event)) return;
    if (!this.snapshotStart) return;
    event.preventDefault();
    this.updateSnapshotRect(event.clientX, event.clientY);
  }

  private handleSnapshotPointerUp(event: PointerEvent, allowOverlayEvent = false): void {
    if (!allowOverlayEvent && this.eventStartedInOverlay(event)) return;
    const activeSelection = this.activeSelection;
    const start = this.snapshotStart;
    if (!activeSelection || activeSelection.mode !== "snapshot" || !start) return;
    event.preventDefault();

    const boundingRect = normalizedRect(start.x, start.y, event.clientX, event.clientY);
    if (boundingRect.width < MIN_SNAPSHOT_SIZE_PX || boundingRect.height < MIN_SNAPSHOT_SIZE_PX) {
      this.finish({ status: "snapshot_too_small", requestId: activeSelection.requestId });
      return;
    }

    this.finish({
      status: "area_snapshot",
      requestId: activeSelection.requestId,
      frameDocumentUrl: this.window.location.href,
      selection: {
        mode: "area_snapshot",
        viewport: this.currentViewport(),
        boundingRect,
        captureProof: this.captureProof(activeSelection.requestId, activeSelection.tabId, activeSelection.windowId)
      }
    });
  }

  private mountOverlay(): void {
    if (this.overlayHost?.isConnected) return;
    const host = this.document.createElement("div");
    host.setAttribute("data-sidra-page-selection-root", "");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          font-family: system-ui, sans-serif;
        }
        .capture-layer {
          position: fixed;
          inset: 0;
          pointer-events: auto;
        }
        .toolbar {
          position: fixed;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 6px;
          padding: 6px;
          border: 1px solid rgba(15, 23, 42, 0.18);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 8px 26px rgba(15, 23, 42, 0.18);
          pointer-events: auto;
        }
        button {
          border: 0;
          border-radius: 6px;
          padding: 6px 10px;
          background: #f1f5f9;
          color: #0f172a;
          font: inherit;
        }
      </style>
      <div class="toolbar" role="toolbar" aria-label="Select page context">
        <button type="button" data-action="text">Text</button>
        <button type="button" data-action="snapshot">Snapshot</button>
        <button type="button" data-action="cancel">Cancel</button>
      </div>
    `;
    shadow.querySelector('[data-action="text"]')?.addEventListener("click", () => this.switchMode("text"));
    shadow.querySelector('[data-action="snapshot"]')?.addEventListener("click", () => this.switchMode("snapshot"));
    shadow.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      if (this.activeSelection) this.cancel(this.activeSelection.requestId);
    });
    this.document.documentElement.append(host);
    this.overlayHost = host;
  }

  private switchMode(mode: PageSelectionMode): void {
    if (this.activeSelection) this.activeSelection.mode = mode;
    this.setCursor(mode === "text" ? "text" : "crosshair");
    this.syncOverlayModeControls(mode);
    if (mode === "snapshot") this.ensureSnapshotCaptureLayer();
    else this.removeSnapshotCaptureLayer();
  }

  private syncOverlayModeControls(mode: PageSelectionMode): void {
    const shadowRoot = this.overlayHost?.shadowRoot;
    if (!shadowRoot) return;
    shadowRoot
      .querySelector('[data-action="text"]')
      ?.setAttribute("aria-pressed", mode === "text" ? "true" : "false");
    shadowRoot
      .querySelector('[data-action="snapshot"]')
      ?.setAttribute("aria-pressed", mode === "snapshot" ? "true" : "false");
  }

  private ensureSnapshotCaptureLayer(): void {
    const shadowRoot = this.overlayHost?.shadowRoot;
    if (!shadowRoot || this.snapshotCaptureLayer?.isConnected) return;
    const captureLayer = this.document.createElement("div");
    captureLayer.className = "capture-layer";
    captureLayer.setAttribute("data-sidra-snapshot-capture-layer", "");
    shadowRoot.prepend(captureLayer);
    this.addSnapshotCaptureLayerListener(captureLayer, "pointerdown", (event) =>
      this.handleSnapshotPointerDown(event as PointerEvent, true)
    );
    this.addSnapshotCaptureLayerListener(captureLayer, "pointermove", (event) =>
      this.handleSnapshotPointerMove(event as PointerEvent, true)
    );
    this.addSnapshotCaptureLayerListener(captureLayer, "pointerup", (event) =>
      this.handleSnapshotPointerUp(event as PointerEvent, true)
    );
    this.snapshotCaptureLayer = captureLayer;
  }

  private removeSnapshotCaptureLayer(): void {
    while (this.snapshotCaptureLayerCleanupCallbacks.length > 0) this.snapshotCaptureLayerCleanupCallbacks.pop()?.();
    this.snapshotCaptureLayer?.remove();
    this.snapshotCaptureLayer = undefined;
    this.snapshotStart = undefined;
    this.snapshotRectElement?.remove();
    this.snapshotRectElement = undefined;
  }

  private updateSnapshotRect(clientX: number, clientY: number): void {
    if (!this.overlayHost?.shadowRoot || !this.snapshotStart) return;
    if (!this.snapshotRectElement) {
      const rectElement = this.document.createElement("div");
      rectElement.setAttribute("data-sidra-snapshot-rect", "");
      rectElement.style.position = "fixed";
      rectElement.style.border = "2px solid #2563eb";
      rectElement.style.background = "rgba(37, 99, 235, 0.12)";
      rectElement.style.pointerEvents = "none";
      this.overlayHost.shadowRoot.append(rectElement);
      this.snapshotRectElement = rectElement;
    }
    const rect = normalizedRect(this.snapshotStart.x, this.snapshotStart.y, clientX, clientY);
    Object.assign(this.snapshotRectElement.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  }

  private selectedTextRects(): PageContextRect[] {
    const selection = this.document.getSelection();
    if (!selection || selection.rangeCount === 0) return [];
    const rects: PageContextRect[] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0 && rect.height > 0) {
          rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
      }
    }
    return rects;
  }

  private eventStartedInOverlay(event: Event): boolean {
    if (!this.overlayHost) return false;
    return event.composedPath().includes(this.overlayHost);
  }

  private currentViewport(): PageContextViewport {
    return {
      width: this.window.innerWidth,
      height: this.window.innerHeight,
      devicePixelRatio: this.window.devicePixelRatio,
      scrollX: this.window.scrollX,
      scrollY: this.window.scrollY
    };
  }

  private captureProof(requestId: string, tabId?: number, windowId?: number): PageContextCaptureProof {
    return {
      requestId,
      ...(tabId !== undefined ? { tabId } : {}),
      ...(windowId !== undefined ? { windowId } : {}),
      documentUrl: this.window.location.href,
      viewport: this.currentViewport()
    };
  }

  private addDocumentListener(type: string, listener: EventListener): void {
    this.document.addEventListener(type, listener, true);
    this.cleanupCallbacks.push(() => this.document.removeEventListener(type, listener, true));
  }

  private addElementListener(element: Element, type: string, listener: EventListener): void {
    element.addEventListener(type, listener);
    this.cleanupCallbacks.push(() => element.removeEventListener(type, listener));
  }

  private addSnapshotCaptureLayerListener(element: Element, type: string, listener: EventListener): void {
    element.addEventListener(type, listener);
    this.snapshotCaptureLayerCleanupCallbacks.push(() => element.removeEventListener(type, listener));
  }

  private setCursor(cursor: string): void {
    this.document.documentElement.style.cursor = cursor;
  }

  private finish(response: PageSelectionContentResponse): void {
    const activeSelection = this.activeSelection;
    if (!activeSelection) return;
    this.cleanup();
    activeSelection.resolve(response);
  }

  private cleanup(): void {
    while (this.cleanupCallbacks.length > 0) this.cleanupCallbacks.pop()?.();
    this.overlayHost?.remove();
    this.overlayHost = undefined;
    this.removeSnapshotCaptureLayer();
    this.snapshotRectElement = undefined;
    this.snapshotStart = undefined;
    this.setCursor("");
    this.activeSelection = undefined;
  }
}

function normalizedRect(startX: number, startY: number, endX: number, endY: number): PageContextRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

function unionRects(rects: PageContextRect[]): PageContextRect | undefined {
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function isPageSelectionContentMessage(value: unknown): value is PageSelectionContentMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PageSelectionContentMessage>;
  return (
    candidate.type === "sidra.pageSelection.start" ||
    candidate.type === "sidra.pageSelection.cancel" ||
    candidate.type === "sidra.pageSelection.readViewportProof"
  );
}

export function installPageSelectionContentScript(controller = new PageSelectionContentController()): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isPageSelectionContentMessage(message)) return false;
    if (message.type === "sidra.pageSelection.start") {
      void controller.start(message).then(sendResponse);
      return true;
    }
    if (message.type === "sidra.pageSelection.cancel") {
      sendResponse(controller.cancel(message.requestId));
      return false;
    }
    sendResponse(controller.readViewportProof(message));
    return false;
  });
}

declare global {
  interface Window {
    __sidraPageSelectionInstalled?: boolean;
  }
}

if (typeof chrome !== "undefined" && typeof document !== "undefined" && !window.__sidraPageSelectionInstalled) {
  window.__sidraPageSelectionInstalled = true;
  installPageSelectionContentScript();
}
