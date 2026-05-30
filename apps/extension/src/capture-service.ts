import { Readability } from "@mozilla/readability";
import type { PageContext, PageContextMetadata } from "@sidra/protocol";
import { type ActivePageTab } from "./active-page";
import type { CaptureMode } from "./capture-mode";
import { captureCurrentDocumentSnapshot, type CapturedTabDocument } from "./capture-script";
import { normalizeFavIconUrl, resolvePageIdentity, type PageIdentity } from "./page-key";
import { createDefaultSettingsSource, type SidraSettings } from "./settings-store";

export type { CapturedTabDocument };

export const MIN_READABLE_TEXT_LENGTH = 80;

export type CaptureResult =
  | {
      status: "captured";
      pageIdentity: Extract<PageIdentity, { status: "ready" }>;
      pageContext: PageContext;
    }
  | {
      status: "unavailable";
      pageIdentity: PageIdentity;
      message: string;
    };

export type CaptureDocumentResult =
  | {
      status: "captured";
      pageIdentity: Extract<PageIdentity, { status: "ready" }>;
      capturedDocument: CapturedTabDocument;
    }
  | {
      status: "unavailable";
      pageIdentity: PageIdentity;
      message: string;
    };

export type CaptureGateway = {
  queryActiveTab(): Promise<ActivePageTab | undefined>;
  readTabDocument(tabId: number): Promise<CapturedTabDocument>;
};

export type CaptureSettingsSource = {
  getSnapshot(): Pick<SidraSettings, "readableContentLimitCharacters" | "domContentLimitCharacters">;
  whenReady(): Promise<void>;
};

type CaptureServiceOptions = {
  gateway: CaptureGateway;
  settings?: CaptureSettingsSource;
};

export class CaptureService {
  private readonly gateway: CaptureGateway;
  private readonly settings: CaptureSettingsSource;

  constructor(options: CaptureServiceOptions) {
    this.gateway = options.gateway;
    this.settings = options.settings ?? createDefaultSettingsSource();
  }

  async captureActivePageContext(): Promise<CaptureResult> {
    const documentResult = await this.captureActivePageDocument();
    if (documentResult.status === "unavailable") return documentResult;

    return {
      status: "captured",
      pageIdentity: documentResult.pageIdentity,
      pageContext: await this.buildPageContextForCapturedDocument(documentResult.capturedDocument)
    };
  }

  async captureActivePageDocument(): Promise<CaptureDocumentResult> {
    let activeTab: ActivePageTab | undefined;

    try {
      activeTab = await this.gateway.queryActiveTab();
    } catch {
      return unavailable(
        resolvePageIdentity({ url: undefined, title: undefined }),
        "Could not read the active browser tab."
      );
    }

    if (activeTab?.id === undefined) {
      return unavailable(
        resolvePageIdentity({ url: activeTab?.url, title: activeTab?.title, favIconUrl: activeTab?.favIconUrl }),
        "Could not capture this page."
      );
    }

    let capturedDocument: CapturedTabDocument;
    try {
      capturedDocument = await this.gateway.readTabDocument(activeTab.id);
    } catch {
      return unavailable(
        {
          status: "unsupported",
          reason: "active_tab_unavailable",
          url: activeTab.url,
          title: activeTab.title,
          favIconUrl: normalizeFavIconUrl(activeTab.favIconUrl)
        },
        "Could not capture this page."
      );
    }

    const pageIdentity = resolvePageIdentity({
      url: capturedDocument.documentUrl,
      canonicalUrl: capturedDocument.canonicalUrl,
      title: capturedDocument.title,
      favIconUrl: activeTab.favIconUrl
    });
    if (pageIdentity.status !== "ready") {
      return unavailable(pageIdentity, "Could not capture this page.");
    }

    return {
      status: "captured",
      pageIdentity,
      capturedDocument
    };
  }

  async buildPageContextForCapturedDocument(
    capturedDocument: CapturedTabDocument,
    mode: CaptureMode = "readable"
  ): Promise<PageContext> {
    await this.settings.whenReady();
    const settings = this.settings.getSnapshot();

    if (mode === "full_dom") {
      return buildFullDomPageContext(capturedDocument, settings.domContentLimitCharacters);
    }

    return buildReadablePageContext(capturedDocument, settings.readableContentLimitCharacters);
  }
}

export function createChromeCaptureService(settings?: CaptureSettingsSource): CaptureService {
  return new CaptureService({ gateway: createChromeCaptureGateway(), settings });
}

function createChromeCaptureGateway(): CaptureGateway {
  return {
    async queryActiveTab() {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return activeTab;
    },
    async readTabDocument(tabId) {
      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: captureCurrentDocumentSnapshot
      });
      if (!injectionResult?.result) {
        throw new Error("Capture script returned no document snapshot.");
      }
      return injectionResult.result;
    }
  };
}

function buildReadablePageContext(capturedDocument: CapturedTabDocument, readableContentLimitCharacters: number): PageContext {
  const metadata = buildMetadata(capturedDocument);
  const readabilityText = extractReadableText(capturedDocument.html);
  if (isUsableText(readabilityText)) {
    if (readabilityText.length > readableContentLimitCharacters) {
      return metadataOnlyContext(metadata, "content_too_large");
    }
    return readableContext(metadata, readabilityText, "readability");
  }

  const bodyText = normalizeWhitespace(capturedDocument.bodyInnerText);
  if (isUsableText(bodyText)) {
    if (bodyText.length > readableContentLimitCharacters) {
      return metadataOnlyContext(metadata, "content_too_large");
    }
    return readableContext(metadata, bodyText, "body_inner_text");
  }

  return metadataOnlyContext(metadata, "no_usable_text");
}

function buildFullDomPageContext(capturedDocument: CapturedTabDocument, domContentLimitCharacters: number): PageContext {
  const metadata = buildMetadata(capturedDocument);
  if (capturedDocument.html.length > domContentLimitCharacters) {
    return metadataOnlyContext(metadata, "full_dom_too_large");
  }

  return {
    kind: "full_dom",
    metadata,
    html: capturedDocument.html,
    htmlLength: capturedDocument.html.length
  };
}

function buildMetadata(capturedDocument: CapturedTabDocument): PageContextMetadata {
  const metadata: PageContextMetadata = {
    url: capturedDocument.documentUrl,
    capturedAt: capturedDocument.capturedAt
  };
  assignOptional(metadata, "canonicalUrl", capturedDocument.canonicalUrl);
  assignOptional(metadata, "title", capturedDocument.title);
  assignOptional(metadata, "siteName", capturedDocument.siteName);
  assignOptional(metadata, "excerpt", capturedDocument.excerpt);
  assignOptional(metadata, "byline", capturedDocument.byline);
  assignOptional(metadata, "language", capturedDocument.language);
  return metadata;
}

function readableContext(
  metadata: PageContextMetadata,
  text: string,
  extractionMethod: "readability" | "body_inner_text"
): PageContext {
  return {
    kind: "readable",
    metadata,
    text,
    textLength: text.length,
    extractionMethod
  };
}

function metadataOnlyContext(metadata: PageContextMetadata, reason: Extract<PageContext, { kind: "metadata_only" }>["reason"]): PageContext {
  return {
    kind: "metadata_only",
    metadata,
    reason
  };
}

function extractReadableText(html: string): string {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  const article = new Readability(parsedDocument.cloneNode(true) as Document).parse();
  return normalizeWhitespace(article?.textContent ?? "");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isUsableText(text: string): boolean {
  return text.length >= MIN_READABLE_TEXT_LENGTH;
}

function assignOptional<T extends keyof PageContextMetadata>(
  metadata: PageContextMetadata,
  key: T,
  value: PageContextMetadata[T] | undefined
) {
  const cleaned = typeof value === "string" ? value.trim() : value;
  if (cleaned) metadata[key] = cleaned;
}

function unavailable(pageIdentity: PageIdentity, message: string): Extract<CaptureResult, { status: "unavailable" }> {
  return {
    status: "unavailable",
    pageIdentity,
    message
  };
}
