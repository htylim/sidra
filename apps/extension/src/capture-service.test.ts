// @vitest-environment jsdom

import { Readability } from "@mozilla/readability";
import { BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE, type PageContextImage, type PageContextSelectionGeometry } from "@sidra/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAGE_SELECTION_IMAGE_BYTE_LIMIT,
  CaptureService,
  buildAreaSnapshotContextAttachment,
  buildContextBundle,
  buildSelectedTextContextAttachment,
  metadataFromPageIdentity,
  validateSessionSendPayloadSize,
  type CaptureGateway,
  type CaptureSettingsSource,
  type CapturedTabDocument
} from "./capture-service";
import { captureCurrentDocumentSnapshot } from "./capture-script";
import type { PageIdentity, PageKey } from "./page-key";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CaptureService", () => {
  it("does_not_query_or_execute_script_until_capture_is_called", async () => {
    const gateway = new FakeCaptureGateway();

    new CaptureService({ gateway });

    expect(gateway.queryCount).toBe(0);
    expect(gateway.readCount).toBe(0);
  });

  it("extracts_readable_context_with_metadata_from_cloned_document", async () => {
    const gateway = new FakeCaptureGateway({
      document: capturedDocument({
        html: articleHtml({ text: longText("Readable article text") }),
        bodyInnerText: longText("Fallback body text")
      })
    });
    const service = new CaptureService({ gateway });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toMatchObject({
      kind: "readable",
      metadata: {
        url: "https://example.com/current",
        canonicalUrl: "https://example.com/canonical",
        title: "Captured title",
        siteName: "Example Site",
        excerpt: "Captured excerpt",
        byline: "Captured Author",
        language: "en",
        capturedAt: "2026-05-10T12:00:00.000Z"
      },
      extractionMethod: "readability"
    });
    expect(result.pageContext.kind).toBe("readable");
    if (result.pageContext.kind !== "readable") throw new Error("expected readable context");
    expect(result.pageContext.text).toContain("Readable article text");
    expect(result.pageContext.textLength).toBe(result.pageContext.text.length);
  });

  it("builds_readable_context_by_default_when_no_mode_is_provided", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway(),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: 1_000
      })
    });

    const pageContext = await service.buildPageContextForCapturedDocument(capturedDocument());

    expect(pageContext).toMatchObject({ kind: "readable", extractionMethod: "readability" });
  });

  it("builds_full_dom_context_when_full_dom_mode_is_requested", async () => {
    const html = "<html><body><main>Full DOM content</main></body></html>";
    const service = new CaptureService({
      gateway: new FakeCaptureGateway(),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: html.length
      })
    });

    const pageContext = await service.buildPageContextForCapturedDocument(capturedDocument({ html }), "full_dom");

    expect(pageContext).toEqual({
      kind: "full_dom",
      metadata: {
        url: "https://example.com/current",
        canonicalUrl: "https://example.com/canonical",
        title: "Captured title",
        siteName: "Example Site",
        excerpt: "Captured excerpt",
        byline: "Captured Author",
        language: "en",
        capturedAt: "2026-05-10T12:00:00.000Z"
      },
      html,
      htmlLength: html.length
    });
  });

  it("does_not_run_readability_or_send_readable_text_when_full_dom_mode_is_requested", async () => {
    const html = "<html><body><article><p>Short DOM</p></article></body></html>";
    const parseSpy = vi.spyOn(Readability.prototype, "parse");
    const service = new CaptureService({
      gateway: new FakeCaptureGateway(),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 1,
        domContentLimitCharacters: 1_000
      })
    });

    const pageContext = await service.buildPageContextForCapturedDocument(
      capturedDocument({
        html,
        bodyInnerText: longText("Readable fallback text")
      }),
      "full_dom"
    );

    expect(pageContext).toMatchObject({ kind: "full_dom", html });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(pageContext).not.toHaveProperty("text");
    expect(pageContext).not.toHaveProperty("extractionMethod");
  });

  it("returns_full_dom_too_large_metadata_only_when_html_exceeds_dom_limit", async () => {
    const html = "<html><body>oversized</body></html>";
    const service = new CaptureService({
      gateway: new FakeCaptureGateway(),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: html.length - 1
      })
    });

    const pageContext = await service.buildPageContextForCapturedDocument(capturedDocument({ html }), "full_dom");

    expect(pageContext).toEqual({
      kind: "metadata_only",
      metadata: expect.objectContaining({
        url: "https://example.com/current",
        capturedAt: "2026-05-10T12:00:00.000Z"
      }),
      reason: "full_dom_too_large"
    });
    expect(pageContext).not.toHaveProperty("html");
  });

  it("keeps_full_dom_context_when_html_is_exactly_at_dom_limit", async () => {
    const html = "<html><body>exact size</body></html>";
    const service = new CaptureService({
      gateway: new FakeCaptureGateway(),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: html.length
      })
    });

    const pageContext = await service.buildPageContextForCapturedDocument(capturedDocument({ html }), "full_dom");

    expect(pageContext).toMatchObject({
      kind: "full_dom",
      html,
      htmlLength: html.length
    });
  });

  it("waits_for_initial_settings_load_before_full_dom_size_decision", async () => {
    const html = "<html><body>delayed settings</body></html>";
    const settings = new FakeCaptureSettings(
      {
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: 1_000
      },
      { delayReady: true }
    );
    const service = new CaptureService({ gateway: new FakeCaptureGateway(), settings });

    const contextPromise = service.buildPageContextForCapturedDocument(capturedDocument({ html }), "full_dom");
    await flushPromises();
    expect(settings.readyWaitCount).toBe(1);

    settings.setDomLimit(html.length - 1);
    settings.resolveReady();
    await expect(contextPromise).resolves.toMatchObject({
      kind: "metadata_only",
      reason: "full_dom_too_large"
    });
  });

  it("uses_latest_dom_limit_for_later_full_dom_context_builds", async () => {
    const html = "<html><body>live dom limit</body></html>";
    const settings = new FakeCaptureSettings({
      readableContentLimitCharacters: 1_000,
      domContentLimitCharacters: html.length
    });
    const service = new CaptureService({ gateway: new FakeCaptureGateway(), settings });

    await expect(service.buildPageContextForCapturedDocument(capturedDocument({ html }), "full_dom")).resolves.toMatchObject({
      kind: "full_dom"
    });

    settings.setDomLimit(html.length - 1);

    await expect(service.buildPageContextForCapturedDocument(capturedDocument({ html }), "full_dom")).resolves.toMatchObject({
      kind: "metadata_only",
      reason: "full_dom_too_large"
    });
  });

  it("recomputes_page_identity_from_captured_canonical_url", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          canonicalUrl: "https://example.com/canonical?utm_source=newsletter#section",
          documentUrl: "https://example.com/current?x=1"
        })
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageIdentity).toMatchObject({
      status: "ready",
      pageKey: "https://example.com/canonical"
    });
  });

  it("captureActivePageDocument_returns_captured_document_and_uses_the_active_tab_id", async () => {
    const document = capturedDocument({ documentUrl: "https://example.com/document" });
    const gateway = new FakeCaptureGateway({
      tab: { id: 42, url: "https://example.com/tab", title: "Tab title" },
      document
    });
    const service = new CaptureService({ gateway });

    const result = await service.captureActivePageDocument();

    expect(result).toEqual({
      status: "captured",
      pageIdentity: expect.objectContaining({
        status: "ready",
        pageKey: "https://example.com/canonical"
      }),
      capturedDocument: document
    });
    expect(gateway.lastReadTabId).toBe(42);
  });

  it("captureActivePageDocument_returns_unavailable_when_the_active_tab_has_no_id", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        tab: { url: "https://example.com/no-id", title: "No ID" }
      })
    });

    await expect(service.captureActivePageDocument()).resolves.toMatchObject({
      status: "unavailable",
      pageIdentity: {
        status: "ready",
        pageKey: "https://example.com/no-id"
      },
      message: "Could not capture this page."
    });
  });

  it("captureActivePageDocument_returns_unavailable_when_active_tab_query_fails", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        queryError: new Error("Cannot query tabs")
      })
    });

    await expect(service.captureActivePageDocument()).resolves.toMatchObject({
      status: "unavailable",
      pageIdentity: {
        status: "unsupported",
        reason: "missing_url"
      },
      message: "Could not read the active browser tab."
    });
  });

  it("captureActivePageDocument_returns_unavailable_when_document_capture_fails", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        readError: new Error("Cannot access tab")
      })
    });

    await expect(service.captureActivePageDocument()).resolves.toMatchObject({
      status: "unavailable",
      pageIdentity: {
        status: "unsupported",
        reason: "active_tab_unavailable"
      },
      message: "Could not capture this page."
    });
  });

  it("captureActivePageDocument_returns_unavailable_when_the_captured_url_is_unsupported", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          canonicalUrl: undefined,
          documentUrl: "chrome://extensions"
        })
      })
    });

    await expect(service.captureActivePageDocument()).resolves.toMatchObject({
      status: "unavailable",
      pageIdentity: {
        status: "unsupported",
        reason: "unsupported_url",
        url: "chrome://extensions"
      },
      message: "Could not capture this page."
    });
  });

  it("uses_captured_document_url_instead_of_stale_tab_url_when_recomputing_page_identity", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        tab: { id: 7, url: "https://example.com/stale", title: "Stale" },
        document: capturedDocument({
          canonicalUrl: undefined,
          documentUrl: "https://example.com/current?utm_source=newsletter"
        })
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageIdentity).toMatchObject({
      status: "ready",
      pageKey: "https://example.com/current"
    });
  });

  it("falls_back_to_body_inner_text_when_readability_is_missing_or_too_short", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          html: articleHtml({ text: "Too short" }),
          bodyInnerText: `\n ${longText("Body fallback text")} \n`
        })
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toMatchObject({
      kind: "readable",
      extractionMethod: "body_inner_text"
    });
    if (result.pageContext.kind !== "readable") throw new Error("expected readable context");
    expect(result.pageContext.text).toBe(longText("Body fallback text"));
  });

  it("returns_metadata_only_context_when_no_usable_text_exists", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          html: articleHtml({ text: "Too short" }),
          bodyInnerText: "Also short"
        })
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toMatchObject({
      kind: "metadata_only",
      reason: "no_usable_text",
      metadata: {
        url: "https://example.com/current",
        capturedAt: "2026-05-10T12:00:00.000Z"
      }
    });
  });

  it("keeps_readable_page_context_when_selected_text_is_within_configured_limit", async () => {
    const text = longText("Readable article text");
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({ html: articleHtml({ text }) })
      }),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: text.length + 100,
        domContentLimitCharacters: 1_000
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toMatchObject({
      kind: "readable",
      extractionMethod: "readability"
    });
  });

  it("returns_content_too_large_metadata_only_when_readability_exceeds_limit_even_if_body_text_is_under_limit", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          html: articleHtml({ text: longText("Oversized readability article text") }),
          bodyInnerText: textOfLength("body fallback", 100)
        })
      }),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 120,
        domContentLimitCharacters: 1_000
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toEqual(
      expect.objectContaining({
        kind: "metadata_only",
        reason: "content_too_large"
      })
    );
    expect(result.pageContext).not.toHaveProperty("text");
  });

  it("returns_content_too_large_metadata_only_when_body_fallback_text_exceeds_limit", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          html: articleHtml({ text: "Too short" }),
          bodyInnerText: longText("Oversized body fallback text")
        })
      }),
      settings: new FakeCaptureSettings({
        readableContentLimitCharacters: 120,
        domContentLimitCharacters: 1_000
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toEqual(
      expect.objectContaining({
        kind: "metadata_only",
        reason: "content_too_large"
      })
    );
    expect(result.pageContext).not.toHaveProperty("text");
  });

  it("waits_for_initial_settings_load_before_capture_size_decision", async () => {
    const settings = new FakeCaptureSettings(
      {
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: 1_000
      },
      { delayReady: true }
    );
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({ html: articleHtml({ text: longText("Readable article text") }) })
      }),
      settings
    });

    const capturePromise = service.captureActivePageContext();
    await flushPromises();
    expect(settings.readyWaitCount).toBe(1);

    settings.setLimit(120);
    settings.resolveReady();
    const result = await capturePromise;

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext).toMatchObject({ kind: "metadata_only", reason: "content_too_large" });
  });

  it("keeps_click_time_page_identity_when_settings_load_is_delayed", async () => {
    const settings = new FakeCaptureSettings(
      {
        readableContentLimitCharacters: 1_000,
        domContentLimitCharacters: 1_000
      },
      { delayReady: true }
    );
    const gateway = new FakeCaptureGateway({
      document: capturedDocument({
        canonicalUrl: undefined,
        documentUrl: "https://example.com/click-time"
      })
    });
    const service = new CaptureService({ gateway, settings });

    const capturePromise = service.captureActivePageContext();
    await flushPromises();
    gateway.nextDocument = capturedDocument({
      canonicalUrl: undefined,
      documentUrl: "https://example.com/later"
    });
    settings.resolveReady();

    const result = await capturePromise;

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageIdentity).toMatchObject({ pageKey: "https://example.com/click-time" });
  });

  it("uses_latest_readable_limit_for_later_capture_calls", async () => {
    const settings = new FakeCaptureSettings({
      readableContentLimitCharacters: 1_000,
      domContentLimitCharacters: 1_000
    });
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({ html: articleHtml({ text: longText("Readable article text") }) })
      }),
      settings
    });

    await expect(service.captureActivePageContext()).resolves.toMatchObject({
      status: "captured",
      pageContext: { kind: "readable" }
    });

    settings.setLimit(120);

    await expect(service.captureActivePageContext()).resolves.toMatchObject({
      status: "captured",
      pageContext: { kind: "metadata_only", reason: "content_too_large" }
    });
  });

  it("returns_capture_unavailable_when_active_tab_cannot_be_captured", async () => {
    const missingTabService = new CaptureService({ gateway: new FakeCaptureGateway({ tab: undefined }) });
    const failedReadService = new CaptureService({
      gateway: new FakeCaptureGateway({ readError: new Error("Cannot access tab") })
    });

    await expect(missingTabService.captureActivePageContext()).resolves.toMatchObject({
      status: "unavailable",
      pageIdentity: { status: "unsupported", reason: "missing_url" }
    });
    await expect(failedReadService.captureActivePageContext()).resolves.toMatchObject({
      status: "unavailable",
      pageIdentity: { status: "unsupported", reason: "active_tab_unavailable" }
    });
  });

  it("normalizes_whitespace_before_classifying_usable_text", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          html: articleHtml({ text: "Tiny" }),
          bodyInnerText: `  ${longText("Body   fallback\n\n text")}  `
        })
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext.kind).toBe("readable");
    if (result.pageContext.kind !== "readable") throw new Error("expected readable context");
    expect(result.pageContext.text).not.toContain("\n");
    expect(result.pageContext.text).not.toContain("   ");
  });

  it("derives_text_length_from_normalized_readable_text", async () => {
    const service = new CaptureService({
      gateway: new FakeCaptureGateway({
        document: capturedDocument({
          html: articleHtml({ text: `  ${longText("Readable\n\narticle   text")}  ` }),
          bodyInnerText: longText("Fallback body text")
        })
      })
    });

    const result = await service.captureActivePageContext();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("expected captured result");
    expect(result.pageContext.kind).toBe("readable");
    if (result.pageContext.kind !== "readable") throw new Error("expected readable context");
    expect(result.pageContext.textLength).toBe(result.pageContext.text.length);
    expect(result.pageContext.textLength).not.toBe(`  ${longText("Readable\n\narticle   text")}  `.length);
  });

  it("captures_document_snapshot_with_a_self_contained_injected_function", () => {
    document.body.innerHTML = `
      <p>Visible text</p>
      <link rel="canonical" href="https://example.com/canonical">
      <meta property="og:site_name" content="Example Site">
      <meta name="description" content="Captured excerpt">
      <meta name="author" content="Captured Author">
    `;
    document.title = "Captured title";
    document.documentElement.lang = "en";
    const serializedCaptureFunction = captureCurrentDocumentSnapshot.toString();
    const runSerializedCapture = new Function(`return (${serializedCaptureFunction})()`) as () => CapturedTabDocument;

    expect(runSerializedCapture()).toMatchObject({
      title: "Captured title",
      canonicalUrl: "https://example.com/canonical",
      siteName: "Example Site",
      excerpt: "Captured excerpt",
      byline: "Captured Author",
      language: "en"
    });
  });

  describe("capture-time favicon preservation", () => {
    it("carries_active_tab_favicon_url_when_capture_recomputes_page_identity", async () => {
      const service = new CaptureService({
        gateway: new FakeCaptureGateway({
          tab: {
            id: 7,
            url: "https://example.com/stale",
            title: "Tab title",
            favIconUrl: "https://example.com/favicon.ico"
          },
          document: capturedDocument({
            canonicalUrl: "https://example.com/canonical",
            documentUrl: "https://example.com/current"
          })
        })
      });

      const result = await service.captureActivePageDocument();

      expect(result.status).toBe("captured");
      if (result.status !== "captured") throw new Error("expected captured result");
      expect(result.pageIdentity).toMatchObject({
        status: "ready",
        pageKey: "https://example.com/canonical",
        favIconUrl: "https://example.com/favicon.ico"
      });
    });

    it("carries_active_tab_favicon_url_when_capture_is_unavailable", async () => {
      const service = new CaptureService({
        gateway: new FakeCaptureGateway({
          tab: {
            id: 7,
            url: "https://example.com/current",
            title: "Tab title",
            favIconUrl: "https://example.com/favicon.ico"
          },
          readError: new Error("Cannot access tab")
        })
      });

      const result = await service.captureActivePageDocument();

      expect(result).toMatchObject({
        status: "unavailable",
        pageIdentity: {
          status: "unsupported",
          reason: "active_tab_unavailable",
          favIconUrl: "https://example.com/favicon.ico"
        }
      });
    });

    it("omits_blank_active_tab_favicon_url_when_capture_is_unavailable", async () => {
      const service = new CaptureService({
        gateway: new FakeCaptureGateway({
          tab: {
            id: 7,
            url: "https://example.com/current",
            title: "Tab title",
            favIconUrl: "   "
          },
          readError: new Error("Cannot access tab")
        })
      });

      const result = await service.captureActivePageDocument();

      expect(result).toMatchObject({
        status: "unavailable",
        pageIdentity: {
          status: "unsupported",
          reason: "active_tab_unavailable"
        }
      });
      expect(result.pageIdentity).toEqual(expect.not.objectContaining({ favIconUrl: expect.any(String) }));
    });
  });
});

describe("CaptureService page selection attachments", () => {
  it("builds_selected_text_context_attachment_with_geometry_and_preview", () => {
    const result = buildSelectedTextContextAttachment({
      id: "attachment-1",
      pageIdentity: selectionPageIdentity(),
      selectionResult: selectedTextSelectionResult("First line\n  indented selected text"),
      capturedAt: "2026-05-10T12:00:00.000Z",
      readableContentLimitCharacters: 1_000
    });

    expect(result.status).toBe("attached");
    if (result.status !== "attached") throw new Error("expected attachment");
    expect(result.attachment).toMatchObject({
      id: "attachment-1",
      pageContext: {
        kind: "selected_text",
        metadata: {
          url: "https://example.com/frame",
          title: "Selection page",
          capturedAt: "2026-05-10T12:00:00.000Z"
        },
        text: "First line\n  indented selected text",
        textLength: "First line\n  indented selected text".length,
        selection: textSelectionGeometry()
      },
      display: {
        source: "selected_text",
        label: "Selected text",
        pageTitle: "Selection page",
        preview: "First line indented selected text"
      }
    });
  });

  it("builds_too_large_selected_text_as_metadata_only_attachment", () => {
    const result = buildSelectedTextContextAttachment({
      id: "attachment-1",
      pageIdentity: selectionPageIdentity(),
      selectionResult: selectedTextSelectionResult("selected text beyond limit"),
      capturedAt: "2026-05-10T12:00:00.000Z",
      readableContentLimitCharacters: 5
    });

    expect(result.status).toBe("attached");
    if (result.status !== "attached") throw new Error("expected attachment");
    expect(result.attachment.pageContext).toEqual({
      kind: "metadata_only",
      metadata: {
        url: "https://example.com/frame",
        title: "Selection page",
        capturedAt: "2026-05-10T12:00:00.000Z"
      },
      reason: "selection_too_large"
    });
    expect(result.attachment.display.tone).toBe("warning");
    expect(JSON.stringify(result.attachment.display)).not.toContain("selected text beyond limit");
  });

  it("builds_area_snapshot_attachment_with_image_metadata_and_thumbnail", () => {
    const image = pngImage();
    const result = buildAreaSnapshotContextAttachment({
      id: "attachment-2",
      pageIdentity: selectionPageIdentity(),
      selectionResult: snapshotSelectionResult({ image, thumbnailDataUrl: "data:image/png;base64,thumbnail" }),
      capturedAt: "2026-05-10T12:00:00.000Z"
    });

    expect(result.status).toBe("attached");
    if (result.status !== "attached") throw new Error("expected attachment");
    expect(result.attachment).toMatchObject({
      id: "attachment-2",
      pageContext: {
        kind: "area_snapshot",
        metadata: {
          url: "https://example.com/frame",
          title: "Selection page",
          capturedAt: "2026-05-10T12:00:00.000Z"
        },
        image,
        selection: snapshotSelectionGeometry()
      },
      display: {
        source: "area_snapshot",
        label: "Area snapshot",
        thumbnailDataUrl: "data:image/png;base64,thumbnail",
        imageDimensions: { width: 1, height: 1 }
      }
    });
  });

  it("rejects_area_snapshot_attachment_when_image_exceeds_byte_limit", () => {
    const result = buildAreaSnapshotContextAttachment({
      id: "attachment-2",
      pageIdentity: selectionPageIdentity(),
      selectionResult: snapshotSelectionResult({
        image: { ...pngImage(), byteLength: PAGE_SELECTION_IMAGE_BYTE_LIMIT + 1 }
      }),
      capturedAt: "2026-05-10T12:00:00.000Z"
    });

    expect(result).toEqual({ status: "rejected", message: "Selected image is too large to attach." });
  });

  it("builds_context_bundle_with_bundle_metadata_item_metadata_and_sources", () => {
    const selected = buildSelectedTextContextAttachment({
      id: "selected-1",
      pageIdentity: selectionPageIdentity(),
      selectionResult: selectedTextSelectionResult("Selected text"),
      capturedAt: "2026-05-10T12:00:00.000Z",
      readableContentLimitCharacters: 1_000
    });
    const snapshot = buildAreaSnapshotContextAttachment({
      id: "snapshot-1",
      pageIdentity: selectionPageIdentity({ url: "https://example.com/other" }),
      selectionResult: snapshotSelectionResult({ image: pngImage() }),
      capturedAt: "2026-05-10T12:01:00.000Z"
    });
    if (selected.status !== "attached" || snapshot.status !== "attached") throw new Error("expected attachments");
    const pageCapture = {
      kind: "readable" as const,
      metadata: {
        url: "https://example.com/article",
        title: "Captured page",
        capturedAt: "2026-05-10T12:02:00.000Z"
      },
      text: "Readable capture",
      textLength: "Readable capture".length,
      extractionMethod: "readability" as const
    };

    const bundle = buildContextBundle({
      attachments: [selected.attachment, snapshot.attachment],
      metadata: pageCapture.metadata,
      createdAt: "2026-05-10T12:03:00.000Z",
      pageCaptureContext: pageCapture
    });

    expect(bundle).toMatchObject({
      kind: "context_bundle",
      trust: "untrusted",
      metadata: pageCapture.metadata,
      createdAt: "2026-05-10T12:03:00.000Z",
      items: [
        expect.objectContaining({ id: "selected-1", source: "selected_text", trust: "untrusted" }),
        expect.objectContaining({ id: "snapshot-1", source: "area_snapshot", trust: "untrusted" }),
        expect.objectContaining({ id: "page-capture", source: "page_capture", trust: "untrusted" })
      ]
    });
    expect(bundle.kind).toBe("context_bundle");
    if (bundle.kind !== "context_bundle") throw new Error("expected bundle");
    expect(bundle.items[1].context.metadata.url).toBe("https://example.com/frame");
    expect(bundle.items[2].context).toBe(pageCapture);
  });

  it("validates_final_session_send_payload_size_for_bundles", () => {
    const bundle = buildContextBundle({
      attachments: [],
      metadata: metadataFromPageIdentity(selectionPageIdentity(), "2026-05-10T12:00:00.000Z"),
      createdAt: "2026-05-10T12:00:00.000Z",
      pageCaptureContext: {
        kind: "readable",
        metadata: metadataFromPageIdentity(selectionPageIdentity(), "2026-05-10T12:00:00.000Z"),
        text: "Readable text",
        textLength: "Readable text".length,
        extractionMethod: "readability"
      }
    });

    expect(
      validateSessionSendPayloadSize({
        clientSessionId: "client-1",
        prompt: "summarize",
        pageContext: bundle,
        limitBytes: 20
      })
    ).toEqual({ ok: false, message: BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE });
  });
});

class FakeCaptureGateway implements CaptureGateway {
  queryCount = 0;
  readCount = 0;
  lastReadTabId?: number;
  private readonly tab?: { id?: number; url?: string; title?: string; favIconUrl?: string };
  nextDocument: CapturedTabDocument;
  private readonly queryError?: Error;
  private readonly readError?: Error;

  constructor(
    options: {
      tab?: { id?: number; url?: string; title?: string; favIconUrl?: string };
      document?: CapturedTabDocument;
      queryError?: Error;
      readError?: Error;
    } = {}
  ) {
    this.tab = "tab" in options ? options.tab : { id: 7, url: "https://example.com/current", title: "Tab title" };
    this.nextDocument = options.document ?? capturedDocument();
    this.queryError = options.queryError;
    this.readError = options.readError;
  }

  async queryActiveTab() {
    this.queryCount += 1;
    if (this.queryError) throw this.queryError;
    return this.tab;
  }

  async readTabDocument(tabId: number) {
    this.readCount += 1;
    this.lastReadTabId = tabId;
    if (this.readError) throw this.readError;
    return this.nextDocument;
  }
}

class FakeCaptureSettings implements CaptureSettingsSource {
  readyWaitCount = 0;
  private readyPromise?: Promise<void>;
  private resolveReadyPromise?: () => void;
  private readableContentLimitCharacters: number;
  private domContentLimitCharacters: number;

  constructor(
    settings: { readableContentLimitCharacters: number; domContentLimitCharacters: number },
    options: { delayReady?: boolean } = {}
  ) {
    this.readableContentLimitCharacters = settings.readableContentLimitCharacters;
    this.domContentLimitCharacters = settings.domContentLimitCharacters;
    if (options.delayReady) {
      this.readyPromise = new Promise((resolve) => {
        this.resolveReadyPromise = resolve;
      });
    }
  }

  getSnapshot() {
    return {
      readableContentLimitCharacters: this.readableContentLimitCharacters,
      domContentLimitCharacters: this.domContentLimitCharacters
    };
  }

  async whenReady(): Promise<void> {
    this.readyWaitCount += 1;
    await this.readyPromise;
  }

  setLimit(readableContentLimitCharacters: number): void {
    this.readableContentLimitCharacters = readableContentLimitCharacters;
  }

  setDomLimit(domContentLimitCharacters: number): void {
    this.domContentLimitCharacters = domContentLimitCharacters;
  }

  resolveReady(): void {
    this.resolveReadyPromise?.();
  }
}

function capturedDocument(overrides: Partial<CapturedTabDocument> = {}): CapturedTabDocument {
  return {
    documentUrl: "https://example.com/current",
    title: "Captured title",
    html: articleHtml({ text: longText("Readable article text") }),
    bodyInnerText: longText("Fallback body text"),
    capturedAt: "2026-05-10T12:00:00.000Z",
    canonicalUrl: "https://example.com/canonical",
    siteName: "Example Site",
    excerpt: "Captured excerpt",
    byline: "Captured Author",
    language: "en",
    ...overrides
  };
}

function selectionPageIdentity(
  overrides: Partial<Extract<PageIdentity, { status: "ready" }>> = {}
): Extract<PageIdentity, { status: "ready" }> {
  return {
    status: "ready",
    pageKey: "https://example.com/article" as PageKey,
    url: "https://example.com/article",
    title: "Selection page",
    displayTitle: "Selection page",
    ...overrides
  };
}

function selectedTextSelectionResult(text: string) {
  return {
    status: "captured" as const,
    mode: "text" as const,
    frameDocumentUrl: "https://example.com/frame",
    text,
    selection: textSelectionGeometry()
  };
}

function snapshotSelectionResult(input: { image: PageContextImage; thumbnailDataUrl?: string }) {
  return {
    status: "captured" as const,
    mode: "snapshot" as const,
    frameDocumentUrl: "https://example.com/frame",
    image: input.image,
    thumbnailDataUrl: input.thumbnailDataUrl,
    selection: snapshotSelectionGeometry()
  };
}

function textSelectionGeometry(): PageContextSelectionGeometry & { mode: "text_selection" } {
  return {
    mode: "text_selection",
    viewport,
    boundingRect: { x: 10, y: 20, width: 300, height: 60 },
    textRects: [
      { x: 10, y: 20, width: 120, height: 24 },
      { x: 10, y: 48, width: 300, height: 32 }
    ],
    captureProof: {
      requestId: "selection-1",
      tabId: 7,
      windowId: 3,
      documentUrl: "https://example.com/frame",
      viewport
    }
  };
}

function snapshotSelectionGeometry(): PageContextSelectionGeometry & { mode: "area_snapshot" } {
  return {
    mode: "area_snapshot",
    viewport,
    boundingRect: { x: 20, y: 30, width: 100, height: 80 },
    captureProof: {
      requestId: "selection-1",
      tabId: 7,
      windowId: 3,
      documentUrl: "https://example.com/frame",
      viewport,
      screenshotWidth: 1600,
      screenshotHeight: 1200
    }
  };
}

const viewport = {
  width: 800,
  height: 600,
  devicePixelRatio: 2,
  scrollX: 0,
  scrollY: 100
};

function pngImage(): PageContextImage {
  const dataBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  return {
    mimeType: "image/png",
    dataBase64,
    byteLength: atob(dataBase64).length,
    width: 1,
    height: 1
  };
}

function articleHtml(input: { text: string }) {
  return `<!doctype html><html><head><title>HTML title</title></head><body><article><h1>Article</h1><p>${input.text}</p></article></body></html>`;
}

function longText(seed: string) {
  return `${seed} `.repeat(12).trim();
}

function textOfLength(seed: string, length: number) {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}
