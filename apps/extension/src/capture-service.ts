import { Readability } from "@mozilla/readability";
import {
  BRIDGE_HARD_PAYLOAD_BYTE_LIMIT,
  BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE,
  PROTOCOL_VERSION,
  exceedsPayloadByteLimit,
  serializedJsonByteLength,
  type ExtensionToBridge,
  type PageContext,
  type PageContextBase,
  type PageContextBundleItem,
  type PageContextImage,
  type PageContextMetadata
} from "@sidra/protocol";
import { type ActivePageTab } from "./active-page";
import type { CaptureMode } from "./capture-mode";
import { captureCurrentDocumentSnapshot, type CapturedTabDocument } from "./capture-script";
import { normalizeFavIconUrl, resolvePageIdentity, type PageIdentity } from "./page-key";
import type { PageSelectionCaptureResult } from "./page-selection-service";
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

export type SelectedTextAttachmentContext = Extract<PageContextBase, { kind: "selected_text" }>;
export type AreaSnapshotAttachmentContext = Extract<PageContextBase, { kind: "area_snapshot" }>;
export type SelectionTooLargeAttachmentContext = Extract<PageContextBase, { kind: "metadata_only" }> & {
  reason: "selection_too_large";
};

export type ComposerContextAttachment = {
  id: string;
  pageContext: SelectedTextAttachmentContext | AreaSnapshotAttachmentContext | SelectionTooLargeAttachmentContext;
  display: {
    source: "selected_text" | "area_snapshot";
    label: string;
    pageTitle?: string;
    url: string;
    preview: string;
    thumbnailDataUrl?: string;
    imageDimensions?: { width: number; height: number };
    tone?: "warning";
    capturedAt: string;
  };
};

export type ComposerAttachmentSnapshot = ComposerContextAttachment["display"] & {
  id: string;
};

export type BuildComposerAttachmentResult =
  | { status: "attached"; attachment: ComposerContextAttachment }
  | { status: "rejected"; message: string };

export type SessionSendPayloadSizeResult =
  | { ok: true; byteLength: number }
  | { ok: false; message: string };

type CaptureServiceOptions = {
  gateway: CaptureGateway;
  settings?: CaptureSettingsSource;
};

export const PAGE_SELECTION_IMAGE_BYTE_LIMIT = 650_000;
export const COMPOSER_ATTACHMENT_PREVIEW_CHARACTER_LIMIT = 160;
const TRANSPARENT_THUMBNAIL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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

  async buildContextAttachmentForSelection(input: {
    id: string;
    pageIdentity: Extract<PageIdentity, { status: "ready" }>;
    selectionResult: Extract<PageSelectionCaptureResult, { status: "captured" }>;
    capturedAt: string;
  }): Promise<BuildComposerAttachmentResult> {
    await this.settings.whenReady();
    const settings = this.settings.getSnapshot();
    if (input.selectionResult.mode === "text") {
      return buildSelectedTextContextAttachment({
        id: input.id,
        pageIdentity: input.pageIdentity,
        selectionResult: input.selectionResult,
        capturedAt: input.capturedAt,
        readableContentLimitCharacters: settings.readableContentLimitCharacters
      });
    }

    return buildAreaSnapshotContextAttachment({
      id: input.id,
      pageIdentity: input.pageIdentity,
      selectionResult: input.selectionResult,
      capturedAt: input.capturedAt
    });
  }
}

export function buildSelectedTextContextAttachment(input: {
  id: string;
  pageIdentity: Extract<PageIdentity, { status: "ready" }>;
  selectionResult: Extract<PageSelectionCaptureResult, { status: "captured"; mode: "text" }>;
  capturedAt: string;
  readableContentLimitCharacters: number;
}): BuildComposerAttachmentResult {
  const metadata = metadataFromSelection(input.pageIdentity, input.selectionResult.frameDocumentUrl, input.capturedAt);
  if (input.selectionResult.text.length > input.readableContentLimitCharacters) {
    return {
      status: "attached",
      attachment: {
        id: input.id,
        pageContext: {
          kind: "metadata_only",
          metadata,
          reason: "selection_too_large"
        },
        display: {
          source: "selected_text",
          label: "Selected text too large",
          pageTitle: input.pageIdentity.displayTitle,
          url: metadata.url,
          preview: "Selection is too large to attach.",
          tone: "warning",
          capturedAt: input.capturedAt
        }
      }
    };
  }

  const text = input.selectionResult.text;
  return {
    status: "attached",
    attachment: {
      id: input.id,
      pageContext: {
        kind: "selected_text",
        metadata,
        text,
        textLength: text.length,
        selection: input.selectionResult.selection
      },
      display: {
        source: "selected_text",
        label: "Selected text",
        pageTitle: input.pageIdentity.displayTitle,
        url: metadata.url,
        preview: previewText(text),
        capturedAt: input.capturedAt
      }
    }
  };
}

export function buildAreaSnapshotContextAttachment(input: {
  id: string;
  pageIdentity: Extract<PageIdentity, { status: "ready" }>;
  selectionResult: Extract<PageSelectionCaptureResult, { status: "captured"; mode: "snapshot" }>;
  capturedAt: string;
  imageByteLimit?: number;
}): BuildComposerAttachmentResult {
  const imageByteLimit = input.imageByteLimit ?? PAGE_SELECTION_IMAGE_BYTE_LIMIT;
  if (input.selectionResult.image.byteLength > imageByteLimit) {
    return { status: "rejected", message: "Selected image is too large to attach." };
  }

  const metadata = metadataFromSelection(input.pageIdentity, input.selectionResult.frameDocumentUrl, input.capturedAt);
  const image = input.selectionResult.image;
  return {
    status: "attached",
    attachment: {
      id: input.id,
      pageContext: {
        kind: "area_snapshot",
        metadata,
        image,
        selection: input.selectionResult.selection
      },
      display: {
        source: "area_snapshot",
        label: "Area snapshot",
        pageTitle: input.pageIdentity.displayTitle,
        url: metadata.url,
        preview: "Selected page area",
        thumbnailDataUrl: input.selectionResult.thumbnailDataUrl ?? TRANSPARENT_THUMBNAIL_DATA_URL,
        imageDimensions: { width: image.width, height: image.height },
        capturedAt: input.capturedAt
      }
    }
  };
}

export function buildContextBundle(input: {
  attachments: ComposerContextAttachment[];
  metadata: PageContextMetadata;
  createdAt: string;
  pageCaptureContext?: PageContextBase;
}): PageContext {
  const items: PageContextBundleItem[] = input.attachments.map((attachment) => ({
    id: attachment.id,
    label: attachment.display.label,
    trust: "untrusted" as const,
    source: attachmentSourceForContext(attachment.pageContext),
    context: attachment.pageContext
  }));

  if (input.pageCaptureContext) {
    const pageCaptureId = uniquePageCaptureItemId(items.map((item) => item.id));
    items.push({
      id: pageCaptureId,
      label: labelForPageCaptureContext(input.pageCaptureContext),
      trust: "untrusted" as const,
      source: "page_capture" as const,
      context: input.pageCaptureContext
    });
  }

  return {
    kind: "context_bundle",
    trust: "untrusted",
    metadata: input.metadata,
    createdAt: input.createdAt,
    items
  };
}

export function metadataFromPageIdentity(
  pageIdentity: Extract<PageIdentity, { status: "ready" }>,
  capturedAt: string
): PageContextMetadata {
  const metadata: PageContextMetadata = {
    url: pageIdentity.url,
    capturedAt
  };
  assignOptional(metadata, "canonicalUrl", pageIdentity.canonicalUrl);
  assignOptional(metadata, "title", pageIdentity.title ?? pageIdentity.displayTitle);
  return metadata;
}

export function isPageContextBase(pageContext: PageContext): pageContext is PageContextBase {
  return pageContext.kind !== "context_bundle";
}

export function validateSessionSendPayloadSize(input: {
  clientSessionId: string;
  prompt: string;
  pageContext?: PageContext;
  limitBytes?: number;
}): SessionSendPayloadSizeResult {
  const message: ExtensionToBridge = {
    type: "session.send",
    version: PROTOCOL_VERSION,
    clientSessionId: input.clientSessionId,
    prompt: input.prompt,
    ...(input.pageContext ? { pageContext: input.pageContext } : {})
  };
  const byteLength = serializedJsonByteLength(message);
  if (!byteLength.ok) return { ok: false, message: "Message must be valid JSON" };
  if (exceedsPayloadByteLimit(byteLength.byteLength, input.limitBytes ?? BRIDGE_HARD_PAYLOAD_BYTE_LIMIT)) {
    return { ok: false, message: BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE };
  }
  return { ok: true, byteLength: byteLength.byteLength };
}

function metadataFromSelection(
  pageIdentity: Extract<PageIdentity, { status: "ready" }>,
  frameDocumentUrl: string,
  capturedAt: string
): PageContextMetadata {
  const metadata = metadataFromPageIdentity(pageIdentity, capturedAt);
  metadata.url = frameDocumentUrl || metadata.url;
  return metadata;
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= COMPOSER_ATTACHMENT_PREVIEW_CHARACTER_LIMIT) return normalized;
  return `${normalized.slice(0, COMPOSER_ATTACHMENT_PREVIEW_CHARACTER_LIMIT - 3)}...`;
}

function attachmentSourceForContext(
  context: ComposerContextAttachment["pageContext"]
): "selected_text" | "area_snapshot" {
  return context.kind === "area_snapshot" ? "area_snapshot" : "selected_text";
}

function labelForPageCaptureContext(context: PageContextBase): string {
  if (context.kind === "full_dom") return "Full DOM capture";
  if (context.kind === "metadata_only" && context.reason === "full_dom_too_large") return "Full DOM metadata";
  return "Page capture";
}

function uniquePageCaptureItemId(existingIds: string[]): string {
  const ids = new Set(existingIds);
  if (!ids.has("page-capture")) return "page-capture";
  let index = 2;
  while (ids.has(`page-capture-${index}`)) index += 1;
  return `page-capture-${index}`;
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
