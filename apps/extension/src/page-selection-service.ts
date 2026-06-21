import type {
  PageContextCaptureProof,
  PageContextImage,
  PageContextRect,
  PageContextSelectionGeometry,
  PageContextViewport
} from "@sidra/protocol";
import type {
  PageSelectionContentMessage,
  PageSelectionContentResponse,
  PageSelectionMode
} from "./page-selection-content";

export type PageSelectionScriptMessage = PageSelectionContentMessage;
export type PageSelectionScriptResponse = PageSelectionContentResponse;
export type { PageSelectionMode };

export type PageSelectionActiveTab = {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
};

export type PageSelectionGateway = {
  queryActiveTab(): Promise<PageSelectionActiveTab | undefined>;
  executeScript(injection: {
    target: { tabId: number; allFrames: true };
    files: ["page-selection-content.js"];
  }): Promise<Array<{ frameId?: number }>>;
  sendMessage(
    tabId: number,
    message: PageSelectionScriptMessage,
    options: { frameId: number }
  ): Promise<PageSelectionScriptResponse>;
  captureVisibleTab(windowId: number, options: { format: "png" }): Promise<string>;
  now(): number;
};

export type PageSelectionImageProcessor = {
  readPngDimensions(dataUrl: string): Promise<{ width: number; height: number }>;
  cropPng(dataUrl: string, rect: PageContextRect): Promise<PageContextImage>;
};

export type PageSelectionCaptureResult =
  | {
      status: "captured";
      mode: "text";
      text: string;
      frameDocumentUrl: string;
      selection: PageContextSelectionGeometry & { mode: "text_selection" };
    }
  | {
      status: "captured";
      mode: "snapshot";
      frameDocumentUrl: string;
      image: PageContextImage;
      thumbnailDataUrl?: string;
      selection: PageContextSelectionGeometry & { mode: "area_snapshot" };
    }
  | { status: "unavailable"; message: string };

type PageSelectionServiceOptions = {
  gateway: PageSelectionGateway;
  imageProcessor?: PageSelectionImageProcessor;
  createRequestId?: () => string;
  selectionTimeoutMs?: number;
};

type ActivePageSelectionRequest = {
  tabId?: number;
  frameIds: number[];
  requestId: string;
  cancelled: boolean;
  cleanupStarted: boolean;
  cancellation: Promise<PageSelectionCaptureResult>;
  cancel(result: PageSelectionCaptureResult): void;
};

const SNAPSHOT_RATE_LIMIT_MS = 500;
const DEFAULT_SELECTION_TIMEOUT_MS = 30_000;
const SNAPSHOT_DIMENSION_TOLERANCE_PX = 8;

export class PageSelectionService {
  private readonly gateway: PageSelectionGateway;
  private readonly imageProcessor: PageSelectionImageProcessor;
  private readonly createRequestId: () => string;
  private readonly selectionTimeoutMs: number;
  private lastSnapshotCaptureAtMs = Number.NEGATIVE_INFINITY;
  private snapshotCaptureInFlight = false;
  private activeRequest?: ActivePageSelectionRequest;

  constructor(options: PageSelectionServiceOptions) {
    this.gateway = options.gateway;
    this.imageProcessor = options.imageProcessor ?? new BrowserPageSelectionImageProcessor();
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.selectionTimeoutMs = options.selectionTimeoutMs ?? DEFAULT_SELECTION_TIMEOUT_MS;
  }

  async start(mode: PageSelectionMode): Promise<PageSelectionCaptureResult> {
    this.cancelActiveRequest();
    const request = this.createActiveRequest(this.createRequestId());
    this.activeRequest = request;
    const timeoutId = setTimeout(() => {
      request.cancel(unavailable("Page selection timed out."));
    }, this.selectionTimeoutMs);

    try {
      if (mode === "snapshot" && this.snapshotCaptureIsRateLimited()) {
        return unavailable("Snapshot capture is already rate limited.");
      }

      let activeTab: PageSelectionActiveTab | undefined;
      try {
        const activeTabResult = await this.withRequestCancellation(this.gateway.queryActiveTab(), request);
        if (activeTabResult.status === "cancelled") return activeTabResult.result;
        activeTab = activeTabResult.value;
      } catch {
        return unavailable("Could not read the active browser tab.");
      }
      if (request.cancelled) return unavailable("Page selection was cancelled.");

      if (activeTab?.id === undefined || activeTab.windowId === undefined || !activeTab.url) {
        return unavailable("Could not select this page.");
      }
      const selectedTab = {
        id: activeTab.id,
        windowId: activeTab.windowId,
        url: activeTab.url,
        title: activeTab.title
      };

      let frameIds: number[];
      try {
        const injectionResults = await this.withRequestCancellation(
          this.gateway.executeScript({
            target: { tabId: selectedTab.id, allFrames: true },
            files: ["page-selection-content.js"]
          }),
          request
        );
        if (injectionResults.status === "cancelled") return injectionResults.result;
        frameIds = deterministicFrameIds(injectionResults.value);
      } catch {
        return unavailable("Could not start page selection on this page.");
      }
      if (request.cancelled) return unavailable("Page selection was cancelled.");

      if (frameIds.length === 0) return unavailable("Could not start page selection on this page.");

      request.tabId = selectedTab.id;
      request.frameIds = frameIds;
      const startResponses = this.sendStartMessages(selectedTab.id, frameIds, request.requestId, mode, selectedTab);
      return await this.handleSelectionResponses(startResponses, request, selectedTab);
    } finally {
      clearTimeout(timeoutId);
      await this.cleanupRequestFrames(request);
      if (this.activeRequest === request) this.activeRequest = undefined;
    }
  }

  shutdown(): void {
    this.cancelActiveRequest();
  }

  private createActiveRequest(requestId: string): ActivePageSelectionRequest {
    let resolveCancellation!: (result: PageSelectionCaptureResult) => void;
    const cancellation = new Promise<PageSelectionCaptureResult>((resolve) => {
      resolveCancellation = resolve;
    });

    return {
      frameIds: [],
      requestId,
      cancelled: false,
      cleanupStarted: false,
      cancellation,
      cancel(result) {
        if (this.cancelled) return;
        this.cancelled = true;
        resolveCancellation(result);
      }
    };
  }

  private cancelActiveRequest(): void {
    const request = this.activeRequest;
    request?.cancel(unavailable("Page selection was cancelled."));
  }

  private async withRequestCancellation<T>(
    promise: Promise<T>,
    request: ActivePageSelectionRequest
  ): Promise<{ status: "completed"; value: T } | { status: "cancelled"; result: PageSelectionCaptureResult }> {
    return await Promise.race([
      promise.then((value) => ({ status: "completed" as const, value })),
      request.cancellation.then((result) => ({ status: "cancelled" as const, result }))
    ]);
  }

  private sendStartMessages(
    tabId: number,
    frameIds: number[],
    requestId: string,
    mode: PageSelectionMode,
    activeTab: PageSelectionActiveTab
  ): Array<Promise<PageSelectionScriptResponse>> {
    return frameIds.map(async (frameId) => {
      try {
        return await this.gateway.sendMessage(
          tabId,
          {
            type: "sidra.pageSelection.start",
            requestId,
            mode: frameId === 0 ? mode : "text",
            topFrame: frameId === 0,
            tabId: activeTab.id,
            windowId: activeTab.windowId
          },
          { frameId }
        );
      } catch {
        return { status: "ignored" as const, requestId };
      }
    });
  }

  private async handleSelectionResponses(
    responses: Array<Promise<PageSelectionScriptResponse>>,
    request: ActivePageSelectionRequest,
    activeTab: Required<Pick<PageSelectionActiveTab, "id" | "windowId" | "url">>
  ): Promise<PageSelectionCaptureResult> {
    return await new Promise((resolve) => {
      let settled = false;
      let pendingCount = responses.length;
      const timeoutId = setTimeout(() => {
        request.cancel(unavailable("Page selection timed out."));
      }, this.selectionTimeoutMs);
      const resolveOnce = (result: PageSelectionCaptureResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };
      void request.cancellation.then(resolveOnce);

      for (const responsePromise of responses) {
        void responsePromise.then(async (response) => {
          if (settled) return;
          if (response.status === "selected_text" && response.requestId === request.requestId && response.text.trim().length > 0) {
            const currentTab = await this.queryMatchingActiveTab(activeTab);
            if (request.cancelled) {
              resolveOnce(unavailable("Page selection was cancelled."));
              return;
            }
            resolveOnce(
              currentTab
                ? {
                    status: "captured",
                    mode: "text",
                    frameDocumentUrl: response.frameDocumentUrl,
                    text: response.text,
                    selection: response.selection
                  }
                : unavailable("The page changed before selection completed.")
            );
            return;
          }
          if (response.status === "area_snapshot" && response.requestId === request.requestId) {
            this.handleSnapshotResponse(response, request, activeTab).then(resolveOnce);
            return;
          }
          if (response.status === "cancelled" && response.requestId === request.requestId) {
            resolveOnce(unavailable("Page selection was cancelled."));
            return;
          }
          if (response.status === "empty_text" && response.requestId === request.requestId) {
            resolveOnce(unavailable("No text was selected."));
            return;
          }
          if (response.status === "snapshot_too_small" && response.requestId === request.requestId) {
            resolveOnce(unavailable("The selected area is too small."));
            return;
          }

          pendingCount -= 1;
          if (pendingCount === 0) resolveOnce(unavailable("No page selection was completed."));
        });
      }
    });
  }

  private async handleSnapshotResponse(
    snapshot: Extract<PageSelectionScriptResponse, { status: "area_snapshot" }>,
    request: ActivePageSelectionRequest,
    activeTab: Required<Pick<PageSelectionActiveTab, "id" | "windowId" | "url">>
  ): Promise<PageSelectionCaptureResult> {
    if (request.cancelled) return unavailable("Page selection was cancelled.");

    const currentTab = await this.queryMatchingActiveTab(activeTab);
    if (request.cancelled) return unavailable("Page selection was cancelled.");
    if (!currentTab) return unavailable("The page changed before the snapshot was captured.");

    const currentProof = await this.readCurrentViewportProof(currentTab.id, request.requestId);
    if (request.cancelled) return unavailable("Page selection was cancelled.");
    if (!currentProof || !this.snapshotProofStillMatches(snapshot.selection.captureProof, currentProof, currentTab)) {
      return unavailable("The page changed before the snapshot was captured.");
    }

    if (this.snapshotCaptureIsRateLimited()) return unavailable("Snapshot capture is already rate limited.");
    if (request.cancelled) return unavailable("Page selection was cancelled.");

    this.snapshotCaptureInFlight = true;
    this.lastSnapshotCaptureAtMs = this.gateway.now();
    try {
      const screenshotDataUrl = await this.gateway.captureVisibleTab(currentTab.windowId, { format: "png" });
      if (request.cancelled) return unavailable("Page selection was cancelled.");

      const afterScreenshotTab = await this.queryMatchingActiveTab(activeTab);
      const afterScreenshotProof = afterScreenshotTab
        ? await this.readCurrentViewportProof(afterScreenshotTab.id, request.requestId)
        : undefined;
      if (request.cancelled) return unavailable("Page selection was cancelled.");
      if (
        !afterScreenshotTab ||
        !afterScreenshotProof ||
        !this.snapshotProofStillMatches(snapshot.selection.captureProof, afterScreenshotProof, afterScreenshotTab)
      ) {
        return unavailable("The page changed before the snapshot was captured.");
      }

      const dimensions = await this.imageProcessor.readPngDimensions(screenshotDataUrl);
      if (request.cancelled) return unavailable("Page selection was cancelled.");
      if (!screenshotDimensionsMatchViewport(dimensions, snapshot.selection.viewport)) {
        return unavailable("The page changed before the snapshot was captured.");
      }
      const cropRect = cropRectForViewportSelection(snapshot.selection.boundingRect, snapshot.selection.viewport, dimensions);
      const image = await this.imageProcessor.cropPng(screenshotDataUrl, cropRect);
      if (request.cancelled) return unavailable("Page selection was cancelled.");
      return {
        status: "captured",
        mode: "snapshot",
        frameDocumentUrl: snapshot.frameDocumentUrl,
        image,
        selection: {
          ...snapshot.selection,
          captureProof: {
            ...snapshot.selection.captureProof,
            screenshotWidth: dimensions.width,
            screenshotHeight: dimensions.height
          }
        }
      };
    } catch {
      return unavailable("Could not capture the selected area.");
    } finally {
      this.snapshotCaptureInFlight = false;
    }
  }

  private async queryMatchingActiveTab(
    expectedTab: Required<Pick<PageSelectionActiveTab, "id" | "windowId" | "url">>
  ): Promise<Required<Pick<PageSelectionActiveTab, "id" | "windowId" | "url">> | undefined> {
    try {
      const currentTab = await this.gateway.queryActiveTab();
      if (currentTab?.id !== expectedTab.id || currentTab.windowId !== expectedTab.windowId || currentTab.url !== expectedTab.url) {
        return undefined;
      }
      return { id: currentTab.id, windowId: currentTab.windowId, url: currentTab.url };
    } catch {
      return undefined;
    }
  }

  private async readCurrentViewportProof(tabId: number, requestId: string): Promise<PageContextCaptureProof | undefined> {
    try {
      const response = await this.gateway.sendMessage(
        tabId,
        { type: "sidra.pageSelection.readViewportProof", requestId },
        { frameId: 0 }
      );
      return response.status === "viewport_proof" && response.requestId === requestId ? response.proof : undefined;
    } catch {
      return undefined;
    }
  }

  private snapshotProofStillMatches(
    originalProof: PageContextCaptureProof,
    currentProof: PageContextCaptureProof,
    activeTab: Required<Pick<PageSelectionActiveTab, "id" | "windowId" | "url">>
  ): boolean {
    if (originalProof.tabId !== undefined && originalProof.tabId !== activeTab.id) return false;
    if (currentProof.tabId !== undefined && currentProof.tabId !== activeTab.id) return false;
    if (originalProof.windowId !== undefined && originalProof.windowId !== activeTab.windowId) return false;
    if (currentProof.windowId !== undefined && currentProof.windowId !== activeTab.windowId) return false;
    if (originalProof.documentUrl !== activeTab.url || currentProof.documentUrl !== activeTab.url) return false;
    return sameViewport(originalProof.viewport, currentProof.viewport);
  }

  private snapshotCaptureIsRateLimited(): boolean {
    if (this.snapshotCaptureInFlight) return true;
    return this.gateway.now() - this.lastSnapshotCaptureAtMs < SNAPSHOT_RATE_LIMIT_MS;
  }

  private async cleanupFrames(tabId: number, frameIds: number[], requestId: string): Promise<void> {
    await Promise.all(
      frameIds.map(async (frameId) => {
        try {
          await this.gateway.sendMessage(tabId, { type: "sidra.pageSelection.cancel", requestId }, { frameId });
        } catch {
          // Frame cleanup is best effort. The request id still prevents stale results from being accepted.
        }
      })
    );
  }

  private async cleanupRequestFrames(request: ActivePageSelectionRequest): Promise<void> {
    if (request.cleanupStarted || request.tabId === undefined || request.frameIds.length === 0) return;
    request.cleanupStarted = true;
    await this.cleanupFrames(request.tabId, request.frameIds, request.requestId);
  }
}

export function createChromePageSelectionService(): PageSelectionService {
  return new PageSelectionService({ gateway: createChromePageSelectionGateway() });
}

function createChromePageSelectionGateway(): PageSelectionGateway {
  return {
    async queryActiveTab() {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return activeTab;
    },
    async executeScript(injection) {
      return await chrome.scripting.executeScript(injection);
    },
    async sendMessage(tabId, message, options) {
      return await chrome.tabs.sendMessage(tabId, message, options);
    },
    async captureVisibleTab(windowId, options) {
      return await chrome.tabs.captureVisibleTab(windowId, options);
    },
    now() {
      return Date.now();
    }
  };
}

function deterministicFrameIds(results: Array<{ frameId?: number }>): number[] {
  const frameIds = new Set<number>();
  for (const result of results) {
    if (typeof result.frameId === "number") frameIds.add(result.frameId);
  }
  return Array.from(frameIds).sort((left, right) => {
    if (left === 0) return -1;
    if (right === 0) return 1;
    return left - right;
  });
}

function screenshotDimensionsMatchViewport(
  dimensions: { width: number; height: number },
  viewport: PageContextViewport
): boolean {
  return (
    Math.abs(dimensions.width - viewport.width * viewport.devicePixelRatio) <= SNAPSHOT_DIMENSION_TOLERANCE_PX &&
    Math.abs(dimensions.height - viewport.height * viewport.devicePixelRatio) <= SNAPSHOT_DIMENSION_TOLERANCE_PX
  );
}

function cropRectForViewportSelection(
  rect: PageContextRect,
  viewport: PageContextViewport,
  dimensions: { width: number; height: number }
): PageContextRect {
  const ratio = viewport.devicePixelRatio;
  const x = clamp(Math.round(rect.x * ratio), 0, dimensions.width);
  const y = clamp(Math.round(rect.y * ratio), 0, dimensions.height);
  const right = clamp(Math.round((rect.x + rect.width) * ratio), x, dimensions.width);
  const bottom = clamp(Math.round((rect.y + rect.height) * ratio), y, dimensions.height);
  return { x, y, width: right - x, height: bottom - y };
}

function sameViewport(left: PageContextViewport, right: PageContextViewport): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.devicePixelRatio === right.devicePixelRatio &&
    left.scrollX === right.scrollX &&
    left.scrollY === right.scrollY
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function unavailable(message: string): PageSelectionCaptureResult {
  return { status: "unavailable", message };
}

class BrowserPageSelectionImageProcessor implements PageSelectionImageProcessor {
  async readPngDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    const bytes = decodePngDataUrl(dataUrl);
    if (bytes.length < 24) throw new Error("PNG data URL is too small.");
    return {
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20)
    };
  }

  async cropPng(dataUrl: string, rect: PageContextRect): Promise<PageContextImage> {
    const blob = await (await fetch(dataUrl)).blob();
    const image = await createImageBitmap(blob);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a canvas context for page selection.");
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);

    const croppedDataUrl = await canvasToDataUrl(canvas);
    const dataBase64 = croppedDataUrl.replace(/^data:image\/png;base64,/, "");
    return {
      mimeType: "image/png",
      dataBase64,
      byteLength: decodeBase64Bytes(dataBase64).length,
      width,
      height
    };
  }
}

type CanvasLike = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToDataUrl(canvas: CanvasLike): Promise<string> {
  if ("convertToBlob" in canvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await blobToDataUrl(blob);
  }
  return canvas.toDataURL("image/png");
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read cropped PNG blob."));
    reader.readAsDataURL(blob);
  });
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  const dataBase64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return decodeBase64Bytes(dataBase64);
}

function decodeBase64Bytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}
