import { describe, expect, it, vi } from "vitest";
import {
  PageSelectionService,
  type PageSelectionGateway,
  type PageSelectionImageProcessor,
  type PageSelectionScriptMessage,
  type PageSelectionScriptResponse
} from "./page-selection-service";

const viewport = {
  width: 800,
  height: 600,
  devicePixelRatio: 2,
  scrollX: 0,
  scrollY: 120
};

const activeTab = {
  id: 42,
  windowId: 7,
  url: "https://example.com/article",
  title: "Example article"
};

const selectionProof = {
  requestId: "selection-1",
  tabId: activeTab.id,
  windowId: activeTab.windowId,
  documentUrl: activeTab.url,
  viewport
};

function selectedTextResponse(requestId = "selection-1"): PageSelectionScriptResponse {
  return {
    status: "selected_text",
    requestId,
    frameDocumentUrl: activeTab.url,
    text: "Selected text",
    selection: {
      mode: "text_selection",
      viewport,
      boundingRect: { x: 20, y: 40, width: 220, height: 32 },
      textRects: [{ x: 20, y: 40, width: 220, height: 32 }],
      captureProof: { ...selectionProof, requestId }
    }
  };
}

function snapshotResponse(requestId = "selection-1"): PageSelectionScriptResponse {
  return {
    status: "area_snapshot",
    requestId,
    frameDocumentUrl: activeTab.url,
    selection: {
      mode: "area_snapshot",
      viewport,
      boundingRect: { x: 20, y: 40, width: 200, height: 120 },
      captureProof: { ...selectionProof, requestId }
    }
  };
}

function viewportProofResponse(requestId = "selection-1"): PageSelectionScriptResponse {
  return {
    status: "viewport_proof",
    requestId,
    proof: { ...selectionProof, requestId }
  };
}

type FakeScriptResponse = PageSelectionScriptResponse | Promise<PageSelectionScriptResponse> | Error;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

class FakePageSelectionGateway implements PageSelectionGateway {
  activeTab = activeTab;
  nowMs = 1000;
  injectionResults = [{ frameId: 9 }, { frameId: 0 }, { frameId: 5 }];
  responseByFrameId = new Map<number, FakeScriptResponse>([
    [0, { status: "ignored", requestId: "selection-1" }],
    [5, selectedTextResponse()],
    [9, { status: "ignored", requestId: "selection-1" }]
  ]);
  readonly executeScript = vi.fn(async () => this.injectionResults);
  readonly captureVisibleTab = vi.fn(async () => "data:image/png;base64,full-screenshot");
  readonly cleanupMessages: PageSelectionScriptMessage[] = [];
  readonly sentMessages: Array<{ tabId: number; frameId: number; message: PageSelectionScriptMessage }> = [];

  async queryActiveTab() {
    return this.activeTab;
  }

  async sendMessage(
    tabId: number,
    message: PageSelectionScriptMessage,
    options: { frameId: number }
  ): Promise<PageSelectionScriptResponse> {
    this.sentMessages.push({ tabId, frameId: options.frameId, message });
    if (message.type === "sidra.pageSelection.readViewportProof") {
      return viewportProofResponse(message.requestId);
    }
    if (message.type === "sidra.pageSelection.cancel") {
      this.cleanupMessages.push(message);
      return { status: "cancelled", requestId: message.requestId };
    }
    const response = this.responseByFrameId.get(options.frameId);
    if (response instanceof Error) throw response;
    return await (response ?? { status: "empty_text", requestId: message.requestId });
  }

  now() {
    return this.nowMs;
  }
}

class FakeImageProcessor implements PageSelectionImageProcessor {
  dimensions = { width: 1600, height: 1200 };
  readonly cropPng = vi.fn(async () => ({
    mimeType: "image/png" as const,
    dataBase64: "cropped-image",
    byteLength: 13,
    width: 400,
    height: 240
  }));

  async readPngDimensions() {
    return this.dimensions;
  }
}

function createService(
  gateway = new FakePageSelectionGateway(),
  imageProcessor = new FakeImageProcessor(),
  options: { selectionTimeoutMs?: number; requestIds?: string[] } = {}
) {
  const requestIds = options.requestIds ?? ["selection-1"];
  let nextRequestIdIndex = 0;
  return {
    gateway,
    imageProcessor,
    service: new PageSelectionService({
      gateway,
      imageProcessor,
      createRequestId: () => requestIds[nextRequestIdIndex++] ?? requestIds.at(-1) ?? "selection-1",
      selectionTimeoutMs: options.selectionTimeoutMs
    })
  };
}

function makeSnapshotReadyGateway(): FakePageSelectionGateway {
  const gateway = new FakePageSelectionGateway();
  gateway.responseByFrameId.set(0, snapshotResponse());
  gateway.responseByFrameId.set(5, { status: "ignored", requestId: "selection-1" });
  gateway.responseByFrameId.set(9, { status: "ignored", requestId: "selection-1" });
  return gateway;
}

describe("PageSelectionService", () => {
  it("does_not_inject_until_selection_is_started", () => {
    const { gateway } = createService();

    expect(gateway.executeScript).not.toHaveBeenCalled();
  });

  it("messages_each_injected_frame_with_one_top_frame", async () => {
    const { service, gateway } = createService();

    await service.start("text");

    expect(gateway.executeScript).toHaveBeenCalledWith({
      target: { tabId: activeTab.id, allFrames: true },
      files: ["page-selection-content.js"]
    });
    expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toEqual([
      expect.objectContaining({ frameId: 0, message: expect.objectContaining({ topFrame: true, mode: "text" }) }),
      expect.objectContaining({ frameId: 5, message: expect.objectContaining({ topFrame: false, mode: "text" }) }),
      expect.objectContaining({ frameId: 9, message: expect.objectContaining({ topFrame: false, mode: "text" }) })
    ]);
  });

  it("snapshot_start_arms_iframe_text_listeners_for_later_mode_switch", async () => {
    const gateway = makeSnapshotReadyGateway();
    const { service } = createService(gateway);

    await service.start("snapshot");

    expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toEqual([
      expect.objectContaining({ frameId: 0, message: expect.objectContaining({ topFrame: true, mode: "snapshot" }) }),
      expect.objectContaining({ frameId: 5, message: expect.objectContaining({ topFrame: false, mode: "text" }) }),
      expect.objectContaining({ frameId: 9, message: expect.objectContaining({ topFrame: false, mode: "text" }) })
    ]);
  });

  it("text_start_accepts_snapshot_result_after_overlay_mode_switch", async () => {
    const gateway = new FakePageSelectionGateway();
    gateway.responseByFrameId.set(0, snapshotResponse());
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));
    const { service } = createService(gateway);

    await expect(service.start("text")).resolves.toMatchObject({
      status: "captured",
      mode: "snapshot"
    });
  });

  it("snapshot_start_accepts_text_result_after_overlay_mode_switch", async () => {
    const gateway = new FakePageSelectionGateway();
    gateway.responseByFrameId.set(0, { status: "ignored", requestId: "selection-1" });
    gateway.responseByFrameId.set(5, selectedTextResponse());
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));
    const { service } = createService(gateway);

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "captured",
      mode: "text",
      text: "Selected text"
    });
  });

  it("messages_all_frames_before_waiting_for_text_selection_results", async () => {
    const { service, gateway } = createService();
    gateway.responseByFrameId.set(0, new Promise<PageSelectionScriptResponse>(() => undefined));

    await expect(service.start("text")).resolves.toMatchObject({
      status: "captured",
      mode: "text",
      text: "Selected text"
    });
    expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toEqual([
      expect.objectContaining({ frameId: 0 }),
      expect.objectContaining({ frameId: 5 }),
      expect.objectContaining({ frameId: 9 })
    ]);
  });

  it("accepts_first_non_empty_frame_selection_and_cleans_up_late_frames", async () => {
    const { service, gateway } = createService();

    await expect(service.start("text")).resolves.toMatchObject({
      status: "captured",
      mode: "text",
      text: "Selected text"
    });
    expect(gateway.cleanupMessages).toHaveLength(3);
  });

  it("ignores_stale_request_ids", async () => {
    const { service, gateway } = createService();
    gateway.responseByFrameId.set(5, selectedTextResponse("old-request"));

    await expect(service.start("text")).resolves.toMatchObject({
      status: "unavailable",
      message: "No page selection was completed."
    });
  });

  it("ignores_text_selection_when_active_tab_changes_before_completion", async () => {
    const { service, gateway } = createService();
    let queryCount = 0;
    gateway.queryActiveTab = async () => {
      queryCount += 1;
      return queryCount === 1 ? activeTab : { ...activeTab, id: 77 };
    };

    await expect(service.start("text")).resolves.toMatchObject({
      status: "unavailable",
      message: "The page changed before selection completed."
    });
  });

  it("reports_inaccessible_frame_text_selection_as_unavailable", async () => {
    const { service, gateway } = createService();
    gateway.responseByFrameId.set(0, new Error("Cannot access frame"));
    gateway.responseByFrameId.set(5, { status: "empty_text", requestId: "selection-1" });
    gateway.responseByFrameId.set(9, { status: "empty_text", requestId: "selection-1" });

    await expect(service.start("text")).resolves.toMatchObject({
      status: "unavailable",
      message: "No text was selected."
    });
  });

  it("text_mode_empty_text_response_completes_immediately_and_cleans_up_frames", async () => {
    const { service, gateway } = createService();
    gateway.responseByFrameId.set(0, { status: "empty_text", requestId: "selection-1" });
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));

    await expect(service.start("text")).resolves.toEqual({ status: "unavailable", message: "No text was selected." });
    expect(gateway.cleanupMessages).toHaveLength(3);
  });

  it("times_out_text_selection_and_cleans_up_frames", async () => {
    vi.useFakeTimers();
    const { service, gateway } = createService(new FakePageSelectionGateway(), new FakeImageProcessor(), {
      selectionTimeoutMs: 5
    });
    gateway.responseByFrameId.set(0, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));

    const result = service.start("text");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);

    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection timed out." });
    expect(gateway.cleanupMessages).toHaveLength(3);
    vi.useRealTimers();
  });

  it("times_out_when_script_injection_never_completes", async () => {
    vi.useFakeTimers();
    const gateway = new FakePageSelectionGateway();
    gateway.executeScript.mockReturnValueOnce(new Promise<Array<{ frameId: number }>>(() => undefined));
    const { service } = createService(gateway, new FakeImageProcessor(), { selectionTimeoutMs: 5 });

    const result = service.start("text");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);

    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection timed out." });
    expect(gateway.sentMessages).toEqual([]);
    expect(gateway.cleanupMessages).toEqual([]);
    vi.useRealTimers();
  });

  it("text_mode_cancel_response_completes_immediately_and_cleans_up_frames", async () => {
    const { service, gateway } = createService();
    gateway.responseByFrameId.set(0, { status: "cancelled", requestId: "selection-1" });
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));

    await expect(service.start("text")).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
    expect(gateway.cleanupMessages).toHaveLength(3);
  });

  it("starting_a_new_selection_cancels_the_previous_active_selection", async () => {
    const { service, gateway } = createService(new FakePageSelectionGateway(), new FakeImageProcessor(), {
      requestIds: ["selection-1", "selection-2"]
    });
    gateway.responseByFrameId.set(0, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));

    const firstResult = service.start("text");
    await vi.waitFor(() =>
      expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toHaveLength(3)
    );
    gateway.responseByFrameId.set(0, { status: "ignored", requestId: "selection-2" });
    gateway.responseByFrameId.set(5, selectedTextResponse("selection-2"));
    gateway.responseByFrameId.set(9, { status: "ignored", requestId: "selection-2" });

    await expect(service.start("text")).resolves.toMatchObject({ status: "captured", text: "Selected text" });
    await expect(firstResult).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
  });

  it("starting_a_new_selection_cancels_previous_request_before_query_completes", async () => {
    const gateway = new FakePageSelectionGateway();
    const delayedQuery = deferred<typeof activeTab>();
    gateway.queryActiveTab = async () => await delayedQuery.promise;
    gateway.responseByFrameId.set(0, { status: "ignored", requestId: "selection-2" });
    gateway.responseByFrameId.set(5, selectedTextResponse("selection-2"));
    gateway.responseByFrameId.set(9, { status: "ignored", requestId: "selection-2" });
    const { service } = createService(gateway, new FakeImageProcessor(), {
      requestIds: ["selection-1", "selection-2"]
    });

    const firstResult = service.start("text");
    const secondResult = service.start("text");
    delayedQuery.resolve(activeTab);

    await expect(firstResult).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
    await expect(secondResult).resolves.toMatchObject({ status: "captured", text: "Selected text" });
  });

  it("starting_a_new_selection_cancels_previous_request_before_injection_completes", async () => {
    const gateway = new FakePageSelectionGateway();
    const delayedInjection = deferred<Array<{ frameId: number }>>();
    gateway.executeScript.mockReturnValueOnce(delayedInjection.promise);
    gateway.responseByFrameId.set(0, { status: "ignored", requestId: "selection-2" });
    gateway.responseByFrameId.set(5, selectedTextResponse("selection-2"));
    gateway.responseByFrameId.set(9, { status: "ignored", requestId: "selection-2" });
    const { service } = createService(gateway, new FakeImageProcessor(), {
      requestIds: ["selection-1", "selection-2"]
    });

    const firstResult = service.start("text");
    await Promise.resolve();
    const secondResult = service.start("text");
    delayedInjection.resolve([{ frameId: 0 }, { frameId: 5 }, { frameId: 9 }]);

    await expect(firstResult).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
    await expect(secondResult).resolves.toMatchObject({ status: "captured", text: "Selected text" });
  });

  it("shutdown_during_text_success_requery_returns_cancelled", async () => {
    const { service, gateway } = createService();
    const requery = deferred<typeof activeTab>();
    let queryCount = 0;
    gateway.queryActiveTab = async () => {
      queryCount += 1;
      return queryCount === 1 ? activeTab : await requery.promise;
    };

    const result = service.start("text");
    await vi.waitFor(() =>
      expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toHaveLength(3)
    );
    service.shutdown();
    requery.resolve(activeTab);

    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
  });

  it("shutdown_cancels_active_selection_frames", async () => {
    const { service, gateway } = createService();
    gateway.responseByFrameId.set(0, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));

    const result = service.start("text");
    await vi.waitFor(() =>
      expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toHaveLength(3)
    );
    service.shutdown();

    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
    await vi.waitFor(() => expect(gateway.cleanupMessages).toHaveLength(3));
  });

  it("captures_snapshot_pixels_after_viewport_proof_is_revalidated", async () => {
    const { service, gateway, imageProcessor } = createService(makeSnapshotReadyGateway());

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "captured",
      mode: "snapshot",
      image: { dataBase64: "cropped-image", width: 400, height: 240 },
      selection: { captureProof: { screenshotWidth: 1600, screenshotHeight: 1200 } }
    });
    expect(gateway.captureVisibleTab).toHaveBeenCalledWith(activeTab.windowId, { format: "png" });
    expect(imageProcessor.cropPng).toHaveBeenCalledWith("data:image/png;base64,full-screenshot", {
      x: 40,
      y: 80,
      width: 400,
      height: 240
    });
  });

  it("snapshot_mode_waits_only_for_the_top_frame_response", async () => {
    const gateway = makeSnapshotReadyGateway();
    gateway.responseByFrameId.set(5, new Promise<PageSelectionScriptResponse>(() => undefined));
    gateway.responseByFrameId.set(9, new Promise<PageSelectionScriptResponse>(() => undefined));
    const { service } = createService(gateway);

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "captured",
      mode: "snapshot"
    });
    expect(gateway.sentMessages.filter((call) => call.message.type === "sidra.pageSelection.start")).toEqual([
      expect.objectContaining({ frameId: 0, message: expect.objectContaining({ topFrame: true, mode: "snapshot" }) }),
      expect.objectContaining({ frameId: 5, message: expect.objectContaining({ topFrame: false, mode: "text" }) }),
      expect.objectContaining({ frameId: 9, message: expect.objectContaining({ topFrame: false, mode: "text" }) })
    ]);
  });

  it("rejects_snapshot_when_viewport_proof_changes", async () => {
    const { service, gateway } = createService(makeSnapshotReadyGateway());
    const originalSendMessage = gateway.sendMessage.bind(gateway);
    gateway.sendMessage = async (tabId, message, options) => {
      if (message.type === "sidra.pageSelection.readViewportProof") {
        return { ...viewportProofResponse(), proof: { ...selectionProof, viewport: { ...viewport, scrollY: 121 } } };
      }
      return await originalSendMessage(tabId, message, options);
    };

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "unavailable",
      message: "The page changed before the snapshot was captured."
    });
    expect(gateway.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("rejects_snapshot_when_viewport_proof_changes_after_screenshot", async () => {
    const { service, gateway } = createService(makeSnapshotReadyGateway());
    let proofReadCount = 0;
    const originalSendMessage = gateway.sendMessage.bind(gateway);
    gateway.sendMessage = async (tabId, message, options) => {
      if (message.type === "sidra.pageSelection.readViewportProof") {
        proofReadCount += 1;
        return proofReadCount === 1
          ? viewportProofResponse()
          : { ...viewportProofResponse(), proof: { ...selectionProof, viewport: { ...viewport, scrollY: 121 } } };
      }
      return await originalSendMessage(tabId, message, options);
    };

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "unavailable",
      message: "The page changed before the snapshot was captured."
    });
    expect(gateway.captureVisibleTab).toHaveBeenCalled();
  });

  it("rejects_snapshot_when_active_tab_changes_before_capture", async () => {
    const { service, gateway } = createService(makeSnapshotReadyGateway());
    let queryCount = 0;
    gateway.queryActiveTab = async () => {
      queryCount += 1;
      return queryCount === 1 ? activeTab : { ...activeTab, windowId: 8 };
    };

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "unavailable",
      message: "The page changed before the snapshot was captured."
    });
    expect(gateway.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("shutdown_before_screenshot_capture_prevents_capture_visible_tab", async () => {
    const { service, gateway } = createService(makeSnapshotReadyGateway());
    const proof = deferred<PageSelectionScriptResponse>();
    const originalSendMessage = gateway.sendMessage.bind(gateway);
    gateway.sendMessage = async (tabId, message, options) => {
      if (message.type === "sidra.pageSelection.readViewportProof") {
        return await proof.promise;
      }
      return await originalSendMessage(tabId, message, options);
    };

    const result = service.start("snapshot");
    await Promise.resolve();
    await Promise.resolve();
    service.shutdown();
    proof.resolve(viewportProofResponse());

    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
    expect(gateway.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("snapshot_timeout_prevents_late_capture_visible_tab", async () => {
    vi.useFakeTimers();
    const gateway = makeSnapshotReadyGateway();
    const proof = deferred<PageSelectionScriptResponse>();
    const originalSendMessage = gateway.sendMessage.bind(gateway);
    gateway.sendMessage = async (tabId, message, options) => {
      if (message.type === "sidra.pageSelection.readViewportProof") return await proof.promise;
      return await originalSendMessage(tabId, message, options);
    };
    const { service } = createService(gateway, new FakeImageProcessor(), { selectionTimeoutMs: 5 });

    const result = service.start("snapshot");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection timed out." });
    proof.resolve(viewportProofResponse());
    await Promise.resolve();

    expect(gateway.captureVisibleTab).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects_screenshot_dimension_mismatch", async () => {
    const { service, gateway, imageProcessor } = createService(makeSnapshotReadyGateway());
    imageProcessor.dimensions = { width: 1570, height: 1200 };

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "unavailable",
      message: "The page changed before the snapshot was captured."
    });
    expect(imageProcessor.cropPng).not.toHaveBeenCalled();
  });

  it("accepts_small_browser_capture_dimension_deltas", async () => {
    const { service, imageProcessor } = createService(makeSnapshotReadyGateway());
    imageProcessor.dimensions = { width: 1602, height: 1193 };

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "captured",
      mode: "snapshot"
    });
    expect(imageProcessor.cropPng).toHaveBeenCalled();
  });

  it("returns_unavailable_when_screenshot_capture_fails", async () => {
    const { service, gateway, imageProcessor } = createService(makeSnapshotReadyGateway());
    gateway.captureVisibleTab.mockRejectedValueOnce(new Error("capture failed"));

    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "unavailable",
      message: "Could not capture the selected area."
    });
    expect(imageProcessor.cropPng).not.toHaveBeenCalled();
  });

  it("shutdown_invalidates_in_flight_snapshot_capture", async () => {
    const gateway = makeSnapshotReadyGateway();
    let releaseCapture!: (dataUrl: string) => void;
    gateway.captureVisibleTab.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        releaseCapture = resolve;
      })
    );
    const { service } = createService(gateway);

    const result = service.start("snapshot");
    await Promise.resolve();
    await Promise.resolve();
    service.shutdown();
    releaseCapture("data:image/png;base64,full-screenshot");

    await expect(result).resolves.toEqual({ status: "unavailable", message: "Page selection was cancelled." });
  });

  it("rate_limits_capture_visible_tab_calls", async () => {
    const { service, gateway } = createService(makeSnapshotReadyGateway());

    await expect(service.start("snapshot")).resolves.toMatchObject({ status: "captured" });
    gateway.nowMs = 1200;
    await expect(service.start("snapshot")).resolves.toMatchObject({
      status: "unavailable",
      message: "Snapshot capture is already rate limited."
    });
  });

  it("does_not_call_capture_visible_tab_for_text_mode", async () => {
    const { service, gateway } = createService();

    await service.start("text");

    expect(gateway.captureVisibleTab).not.toHaveBeenCalled();
  });
});
