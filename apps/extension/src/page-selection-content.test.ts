// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageSelectionContentController } from "./page-selection-content";

function mouseEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
}

function keyboardEvent(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, key });
}

function selectionWithRects(rects: Array<{ x: number; y: number; width: number; height: number }>): Selection {
  return {
    toString: () => "Selected page text",
    rangeCount: 1,
    getRangeAt: () => ({
      getClientRects: () => rects
    })
  } as unknown as Selection;
}

function textSelection(text: string): Selection {
  return { toString: () => text } as Selection;
}

function mockViewport() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
  Object.defineProperty(window, "scrollX", { configurable: true, value: 10 });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 20 });
}

describe("PageSelectionContentController", () => {
  beforeEach(() => {
    document.querySelectorAll("[data-sidra-page-selection-root]").forEach((element) => element.remove());
    document.body.innerHTML = "<main><p>Example selectable text</p></main>";
    document.documentElement.removeAttribute("style");
    vi.restoreAllMocks();
    mockViewport();
  });

  it("starts_text_mode_with_text_cursor_and_native_selection", async () => {
    const controller = new PageSelectionContentController();
    vi.spyOn(document, "getSelection").mockReturnValue(textSelection("  Selected page text  "));

    const result = controller.start({ requestId: "request-1", mode: "text", topFrame: true, tabId: 3, windowId: 4 });

    expect(document.documentElement.style.cursor).toBe("text");
    expect(document.querySelector("[data-sidra-page-selection-root]")?.shadowRoot?.textContent).toContain("Text");

    document.dispatchEvent(mouseEvent("mouseup", 120, 160));

    await expect(result).resolves.toMatchObject({
      status: "selected_text",
      requestId: "request-1",
      text: "  Selected page text  ",
      frameDocumentUrl: window.location.href,
      selection: {
        mode: "text_selection",
        viewport: { width: 800, height: 600, devicePixelRatio: 2, scrollX: 10, scrollY: 20 },
        captureProof: { requestId: "request-1", tabId: 3, windowId: 4, documentUrl: window.location.href }
      }
    });
    expect(document.querySelector("[data-sidra-page-selection-root]")).toBeNull();
    expect(document.documentElement.style.cursor).toBe("");
  });

  it("returns_empty_text_selection_without_leaving_overlay_state", async () => {
    const controller = new PageSelectionContentController();
    vi.spyOn(document, "getSelection").mockReturnValue(textSelection("   "));

    const result = controller.start({ requestId: "request-1", mode: "text", topFrame: true });
    document.dispatchEvent(mouseEvent("mouseup", 120, 160));

    await expect(result).resolves.toMatchObject({ status: "empty_text", requestId: "request-1" });
    expect(document.querySelector("[data-sidra-page-selection-root]")).toBeNull();
    expect(document.documentElement.style.cursor).toBe("");
  });

  it("preserves_selected_text_whitespace_and_indentation", async () => {
    const controller = new PageSelectionContentController();
    const rawText = "  function run() {\n    return true;\n  }  ";
    vi.spyOn(document, "getSelection").mockReturnValue(textSelection(rawText));

    const result = controller.start({ requestId: "request-1", mode: "text", topFrame: true });
    document.dispatchEvent(mouseEvent("mouseup", 120, 160));

    await expect(result).resolves.toMatchObject({ status: "selected_text", text: rawText });
  });

  it("uses_the_union_of_multiline_selected_text_rects", async () => {
    const controller = new PageSelectionContentController();
    vi.spyOn(document, "getSelection").mockReturnValue(
      selectionWithRects([
        { x: 20, y: 40, width: 180, height: 20 },
        { x: 12, y: 68, width: 240, height: 22 }
      ])
    );

    const result = controller.start({ requestId: "request-1", mode: "text", topFrame: true });
    document.dispatchEvent(mouseEvent("mouseup", 120, 160));

    await expect(result).resolves.toMatchObject({
      status: "selected_text",
      selection: {
        boundingRect: { x: 12, y: 40, width: 240, height: 50 },
        textRects: [
          { x: 20, y: 40, width: 180, height: 20 },
          { x: 12, y: 68, width: 240, height: 22 }
        ]
      }
    });
  });

  it("starts_snapshot_mode_with_crosshair_cursor_and_returns_viewport_proof_on_mouseup", async () => {
    const controller = new PageSelectionContentController();

    const result = controller.start({ requestId: "request-1", mode: "snapshot", topFrame: true, tabId: 3, windowId: 4 });
    expect(document.documentElement.style.cursor).toBe("crosshair");
    document.dispatchEvent(mouseEvent("pointerdown", 100, 150));
    document.dispatchEvent(mouseEvent("pointermove", 240, 310));
    document.dispatchEvent(mouseEvent("pointerup", 240, 310));

    await expect(result).resolves.toMatchObject({
      status: "area_snapshot",
      requestId: "request-1",
      selection: {
        mode: "area_snapshot",
        boundingRect: { x: 100, y: 150, width: 140, height: 160 },
        viewport: { width: 800, height: 600, devicePixelRatio: 2, scrollX: 10, scrollY: 20 },
        captureProof: { requestId: "request-1", tabId: 3, windowId: 4, documentUrl: window.location.href }
      }
    });
    expect(document.querySelector("[data-sidra-page-selection-root]")).toBeNull();
  });

  it("snapshot_overlay_captures_pointer_drag_events", async () => {
    const controller = new PageSelectionContentController();

    const result = controller.start({ requestId: "request-1", mode: "snapshot", topFrame: true, tabId: 3, windowId: 4 });
    const captureLayer = document
      .querySelector("[data-sidra-page-selection-root]")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-sidra-snapshot-capture-layer]");

    expect(captureLayer).toBeTruthy();
    captureLayer?.dispatchEvent(mouseEvent("pointerdown", 100, 150));
    captureLayer?.dispatchEvent(mouseEvent("pointermove", 240, 310));
    captureLayer?.dispatchEvent(mouseEvent("pointerup", 240, 310));

    await expect(result).resolves.toMatchObject({
      status: "area_snapshot",
      selection: { boundingRect: { x: 100, y: 150, width: 140, height: 160 } }
    });
  });

  it("rejects_tiny_snapshot_rectangles_and_cleans_up", async () => {
    const controller = new PageSelectionContentController();

    const result = controller.start({ requestId: "request-1", mode: "snapshot", topFrame: true });
    document.dispatchEvent(mouseEvent("pointerdown", 100, 150));
    document.dispatchEvent(mouseEvent("pointerup", 104, 154));

    await expect(result).resolves.toMatchObject({ status: "snapshot_too_small", requestId: "request-1" });
    expect(document.querySelector("[data-sidra-page-selection-root]")).toBeNull();
    expect(document.documentElement.style.cursor).toBe("");
  });

  it("escape_cancels_active_selection_and_removes_shadow_dom", async () => {
    const controller = new PageSelectionContentController();

    const result = controller.start({ requestId: "request-1", mode: "snapshot", topFrame: true });
    expect(document.querySelector("[data-sidra-page-selection-root]")?.shadowRoot).toBeTruthy();

    document.dispatchEvent(keyboardEvent("Escape"));

    await expect(result).resolves.toEqual({ status: "cancelled", requestId: "request-1" });
    expect(document.querySelector("[data-sidra-page-selection-root]")).toBeNull();
    expect(document.documentElement.style.cursor).toBe("");
  });

  it("overlay_cancel_button_cancels_without_triggering_selection_handlers", async () => {
    const controller = new PageSelectionContentController();
    vi.spyOn(document, "getSelection").mockReturnValue(textSelection("   "));

    const result = controller.start({ requestId: "request-1", mode: "text", topFrame: true });
    const cancelButton = document
      .querySelector("[data-sidra-page-selection-root]")
      ?.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="cancel"]');

    cancelButton?.dispatchEvent(mouseEvent("mouseup", 0, 0));
    cancelButton?.click();

    await expect(result).resolves.toEqual({ status: "cancelled", requestId: "request-1" });
  });

  it("overlay_mode_buttons_switch_between_text_and_snapshot_modes", async () => {
    const controller = new PageSelectionContentController();
    vi.spyOn(document, "getSelection").mockReturnValue(textSelection("Selected after switch"));

    const result = controller.start({ requestId: "request-1", mode: "text", topFrame: true });
    const shadowRoot = document.querySelector("[data-sidra-page-selection-root]")?.shadowRoot;
    const snapshotButton = shadowRoot?.querySelector<HTMLButtonElement>('[data-action="snapshot"]');
    const textButton = shadowRoot?.querySelector<HTMLButtonElement>('[data-action="text"]');

    snapshotButton?.click();
    expect(document.documentElement.style.cursor).toBe("crosshair");
    expect(shadowRoot?.querySelector("[data-sidra-snapshot-capture-layer]")).toBeTruthy();

    textButton?.click();
    expect(document.documentElement.style.cursor).toBe("text");
    expect(shadowRoot?.querySelector("[data-sidra-snapshot-capture-layer]")).toBeNull();

    document.dispatchEvent(mouseEvent("mouseup", 120, 160));
    await expect(result).resolves.toMatchObject({ status: "selected_text", text: "Selected after switch" });
  });

  it("is_idempotent_for_repeated_start_messages_in_one_document", () => {
    const controller = new PageSelectionContentController();

    void controller.start({ requestId: "request-1", mode: "text", topFrame: true });
    void controller.start({ requestId: "request-1", mode: "text", topFrame: true });

    expect(document.querySelectorAll("[data-sidra-page-selection-root]")).toHaveLength(1);

    controller.cancel("request-1");
  });
});
