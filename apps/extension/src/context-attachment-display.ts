import type { PageContextImage } from "@sidra/protocol";

export type ContextAttachmentDisplay = {
  id: string;
  source: "selected_text" | "area_snapshot";
  label: string;
  pageTitle?: string;
  url: string;
  preview: string;
  fullText?: string;
  thumbnailDataUrl?: string;
  imageDataUrl?: string;
  imageDimensions?: { width: number; height: number };
  tone?: "warning";
  capturedAt: string;
};

export function pageContextImageDataUrl(image: Pick<PageContextImage, "mimeType" | "dataBase64">): string {
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}
