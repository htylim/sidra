import { useEffect, useState, type ReactNode } from "react";
import type { ContextAttachmentDisplay } from "./context-attachment-display";
import { SidraIcon } from "./sidra-icon";

export type AttachmentClipboardGateway = {
  writeText(text: string): Promise<void>;
};

type CopyState = "idle" | "copied" | "failed";

export function ContextAttachmentList(props: {
  attachments: ContextAttachmentDisplay[];
  clipboard?: AttachmentClipboardGateway;
  readOnly?: boolean;
  onRemoveAttachment?: (attachmentId: string) => boolean;
}) {
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | undefined>();
  const [copyStateByAttachmentId, setCopyStateByAttachmentId] = useState<Record<string, CopyState>>({});

  useEffect(() => {
    if (!previewAttachmentId) return;
    if (props.attachments.some((attachment) => attachment.id === previewAttachmentId)) return;
    setPreviewAttachmentId(undefined);
  }, [props.attachments, previewAttachmentId]);

  useEffect(() => {
    if (!previewAttachmentId) return;
    function closePreviewOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewAttachmentId(undefined);
    }
    window.addEventListener("keydown", closePreviewOnEscape);
    return () => window.removeEventListener("keydown", closePreviewOnEscape);
  }, [previewAttachmentId]);

  if (props.attachments.length === 0) return null;

  const previewAttachment = props.attachments.find((attachment) => attachment.id === previewAttachmentId);

  async function copyAttachmentText(attachment: ContextAttachmentDisplay) {
    const text = attachment.fullText ?? attachment.preview;
    if (!text.trim()) return;

    try {
      if (props.clipboard) {
        await props.clipboard.writeText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyStateByAttachmentId((state) => ({ ...state, [attachment.id]: "copied" }));
    } catch {
      setCopyStateByAttachmentId((state) => ({ ...state, [attachment.id]: "failed" }));
    }
  }

  return (
    <div className={`attachment-chip-list${props.readOnly ? " read-only" : ""}`}>
      {props.attachments.map((attachment) => {
        const previewOpen = attachment.id === previewAttachmentId;
        const previewPanelId = `attachment-preview-${attachment.id}`;
        const chipIsImageOnly = attachment.source === "area_snapshot" && hasAttachmentImage(attachment);
        const chipIsTextOnly = attachment.source === "selected_text";
        return (
          <div
            className={`attachment-chip-item${attachment.tone === "warning" ? " warning" : ""}${
              chipIsImageOnly ? " image-only" : ""
            }${chipIsTextOnly ? " text-only" : ""}`}
            key={attachment.id}
          >
            <div className={`attachment-chip${props.readOnly ? " read-only" : ""}`}>
              <button
                type="button"
                className="attachment-chip-button"
                aria-label={`View ${attachment.label} attachment`}
                aria-expanded={previewOpen}
                aria-controls={previewPanelId}
                onClick={() => setPreviewAttachmentId(previewOpen ? undefined : attachment.id)}
              >
                {attachment.source === "selected_text" ? null : <AttachmentIcon attachment={attachment} />}
                {chipIsImageOnly ? null : (
                  <div className="attachment-chip-copy">
                    <div className="attachment-chip-title">{attachmentSummaryText(attachment)}</div>
                    {attachment.source === "selected_text" ? (
                      <div className="attachment-chip-meta">Selected text</div>
                    ) : null}
                  </div>
                )}
              </button>
              {props.onRemoveAttachment ? (
                <button
                  type="button"
                  className="attachment-chip-remove-button"
                  aria-label={`Remove ${attachment.label} attachment`}
                  onClick={() => props.onRemoveAttachment?.(attachment.id)}
                >
                  <SidraIcon name="trash" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {previewAttachment ? (
        <AttachmentPreviewPopover
          attachment={previewAttachment}
          panelId={`attachment-preview-${previewAttachment.id}`}
          copyState={copyStateByAttachmentId[previewAttachment.id] ?? "idle"}
          onClose={() => setPreviewAttachmentId(undefined)}
          onCopy={() => void copyAttachmentText(previewAttachment)}
        />
      ) : null}
    </div>
  );
}

function hasAttachmentImage(attachment: ContextAttachmentDisplay): boolean {
  return Boolean(attachment.imageDataUrl || attachment.thumbnailDataUrl);
}

function AttachmentIcon(props: { attachment: ContextAttachmentDisplay }) {
  const imageDataUrl =
    props.attachment.source === "area_snapshot"
      ? props.attachment.imageDataUrl ?? props.attachment.thumbnailDataUrl
      : undefined;

  if (imageDataUrl) {
    return (
      <div className="attachment-icon">
        <img src={imageDataUrl} alt="Area snapshot thumbnail" />
      </div>
    );
  }

  return (
    <div className="attachment-icon">
      <SidraIcon name={props.attachment.source === "area_snapshot" ? "image" : "file-text"} />
    </div>
  );
}

function AttachmentPreviewPopover(props: {
  attachment: ContextAttachmentDisplay;
  panelId: string;
  copyState: CopyState;
  onClose(): void;
  onCopy(): void;
}) {
  if (props.attachment.source === "area_snapshot") {
    const imageDataUrl = props.attachment.imageDataUrl ?? props.attachment.thumbnailDataUrl;
    return (
      <div
        className="attachment-preview-popover image-preview"
        id={props.panelId}
        role="dialog"
        aria-label="Area snapshot preview"
      >
        <AttachmentPreviewHeader label="Area snapshot" onClose={props.onClose} />
        {imageDataUrl ? (
          <img className="attachment-preview-image" src={imageDataUrl} alt={`${props.attachment.label} preview`} />
        ) : (
          <div className="attachment-preview-unavailable">Image preview unavailable</div>
        )}
        {props.attachment.imageDimensions ? (
          <div className="attachment-preview-meta">
            {props.attachment.imageDimensions.width} x {props.attachment.imageDimensions.height}
          </div>
        ) : null}
      </div>
    );
  }

  const text = props.attachment.fullText ?? props.attachment.preview;
  return (
    <div
      className="attachment-preview-popover text-preview"
      id={props.panelId}
      role="dialog"
      aria-label="Selected text preview"
    >
      <AttachmentPreviewHeader
        label="Selected text"
        action={
          <button type="button" className="attachment-preview-copy-button" onClick={props.onCopy}>
            {copyButtonLabel(props.copyState)}
          </button>
        }
        onClose={props.onClose}
      />
      <pre>{text}</pre>
    </div>
  );
}

function AttachmentPreviewHeader(props: { label: string; action?: ReactNode; onClose(): void }) {
  return (
    <div className="attachment-preview-header">
      <span>{props.label}</span>
      <div className="attachment-preview-actions">
        {props.action}
        <button type="button" className="attachment-preview-close-button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function copyButtonLabel(copyState: CopyState): string {
  if (copyState === "copied") return "Copied";
  if (copyState === "failed") return "Copy failed";
  return "Copy";
}

function attachmentSummaryText(attachment: ContextAttachmentDisplay): string {
  if (attachment.source === "area_snapshot") return "Area snapshot";
  return attachment.fullText ?? attachment.preview;
}
