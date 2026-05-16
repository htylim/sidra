// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { CaptureService, type CaptureGateway, type CapturedTabDocument } from "./capture-service";
import { captureCurrentDocumentSnapshot } from "./capture-script";

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
});

class FakeCaptureGateway implements CaptureGateway {
  queryCount = 0;
  readCount = 0;
  private readonly tab?: { id?: number; url?: string; title?: string };
  private readonly document: CapturedTabDocument;
  private readonly readError?: Error;

  constructor(options: { tab?: { id?: number; url?: string; title?: string }; document?: CapturedTabDocument; readError?: Error } = {}) {
    this.tab = "tab" in options ? options.tab : { id: 7, url: "https://example.com/current", title: "Tab title" };
    this.document = options.document ?? capturedDocument();
    this.readError = options.readError;
  }

  async queryActiveTab() {
    this.queryCount += 1;
    return this.tab;
  }

  async readTabDocument() {
    this.readCount += 1;
    if (this.readError) throw this.readError;
    return this.document;
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

function articleHtml(input: { text: string }) {
  return `<!doctype html><html><head><title>HTML title</title></head><body><article><h1>Article</h1><p>${input.text}</p></article></body></html>`;
}

function longText(seed: string) {
  return `${seed} `.repeat(12).trim();
}
