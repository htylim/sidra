import type { PageContext, PermissionDecision } from "@sidra/protocol";
import type { BridgeSessionCoordinatorSnapshot } from "./bridge/session-coordinator";
import type { CaptureMode } from "./capture-mode";
import {
  buildContextBundle,
  isPageContextBase,
  metadataFromPageIdentity,
  type ComposerAttachmentSnapshot,
  type ComposerContextAttachment
} from "./capture-service";
import type { PageIdentity, PageKey } from "./page-key";
import type { TranscriptEntry, UserPromptDisplay } from "./transcript";

export type ContextState =
  | { status: "none"; label: "No context sent yet" }
  | { status: "attached"; label: "Context attached"; capturedAt: string }
  | {
      status: "metadata_only";
      label: "Metadata attached";
      capturedAt: string;
      reason: "no_usable_text";
    }
  | {
      status: "content_too_large";
      label: "Content too large";
      capturedAt: string;
      reason: "content_too_large";
    }
  | {
      status: "selection_too_large";
      label: "Selection too large";
      capturedAt: string;
      reason: "selection_too_large";
    }
  | { status: "selected_text_attached"; label: "Selected text attached"; capturedAt: string }
  | { status: "area_snapshot_attached"; label: "Area snapshot attached"; capturedAt: string }
  | { status: "context_attachments_attached"; label: "Context attachments attached"; capturedAt: string }
  | {
      status: "page_capture_and_attachments_attached";
      label: "Page capture and attachments attached";
      capturedAt: string;
    }
  | { status: "full_dom_attached"; label: "Full DOM attached"; capturedAt: string }
  | {
      status: "full_dom_too_large";
      label: "Full DOM skipped: too large";
      capturedAt: string;
      reason: "full_dom_too_large";
    }
  | { status: "capture_unavailable"; label: "Capture unavailable"; message: string };

export type SendMode = "capture" | "send";

export type UrlSessionSnapshot = {
  pageKey: PageKey;
  clientSessionId: string;
  captureMode: CaptureMode;
  sendMode: SendMode;
  draftPrompt: string;
  contextState: ContextState;
  contextAttachments: ComposerAttachmentSnapshot[];
  transcript: TranscriptEntry[];
  pendingPromptCount: number;
  sessionStarted: boolean;
  starting: boolean;
  turnInFlight: boolean;
  canCancelTurn: boolean;
};

export type SessionApproval = {
  permissionKey: string;
  decision: "allow_for_session";
};

export type SessionApprovalState = {
  grant(approval: SessionApproval): void;
  revoke(permissionKey: string): void;
  has(permissionKey: string): boolean;
  list(): SessionApproval[];
  clear(): void;
};

type UrlSessionRecord = {
  pageIdentity: Extract<PageIdentity, { status: "ready" }>;
  clientSessionId: string;
  captureMode: CaptureMode;
  sendMode: SendMode;
  draftPrompt: string;
  contextState: ContextState;
  contextAttachments: ComposerContextAttachment[];
  approvals: SessionApprovalState;
  autoApprovalRequestIds: Set<string>;
  coordinator: UrlSessionCoordinator;
  unsubscribeCoordinator: () => void;
};

export type UrlSessionCoordinator = {
  getSnapshot(): BridgeSessionCoordinatorSnapshot;
  subscribe(listener: () => void): () => void;
  sendPrompt(input: string | { prompt: string; pageContext?: PageContext; userPromptDisplay?: UserPromptDisplay }): boolean;
  cancelTurn?(): boolean;
  recordCaptureUnavailable?(message: string): void;
  respondToPermission?(requestId: string, decision: PermissionDecision): boolean;
  newChat(): void;
  markBridgeDisconnected(): void;
  hasProviderState?(): boolean;
  dispose?(): void;
};

export type UrlSessionStoreOptions = {
  createClientSessionId(): string;
  createCoordinator(clientSessionId: string): UrlSessionCoordinator;
};

export type UrlSessionStoreSnapshot = {
  activeSession: UrlSessionSnapshot;
  sessions: UrlSessionSnapshot[];
};

type Listener = () => void;

const EMPTY_PAGE_KEY = "" as PageKey;
const INITIAL_CONTEXT_STATE: ContextState = { status: "none", label: "No context sent yet" };
export const COMPOSER_CONTEXT_ATTACHMENT_LIMIT = 10;

export class UrlSessionStore {
  private readonly createClientSessionId: () => string;
  private readonly createCoordinator: (clientSessionId: string) => UrlSessionCoordinator;
  private readonly recordsByPageKey = new Map<PageKey, UrlSessionRecord>();
  private readonly listeners = new Set<Listener>();
  private activePageKey?: PageKey;
  private cachedSnapshot?: UrlSessionStoreSnapshot;

  constructor(options: UrlSessionStoreOptions) {
    this.createClientSessionId = options.createClientSessionId;
    this.createCoordinator = options.createCoordinator;
  }

  getSnapshot(): UrlSessionStoreSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot;

    const activeRecord = this.getActiveRecord();
    this.cachedSnapshot = {
      activeSession: activeRecord ? this.snapshotFromRecord(activeRecord) : createEmptySessionSnapshot(),
      sessions: Array.from(this.recordsByPageKey.values()).map((record) => this.snapshotFromRecord(record))
    };
    return this.cachedSnapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  selectPage(
    identity: PageIdentity,
    options: { initialCaptureMode?: CaptureMode; initialSendMode?: SendMode } = {}
  ): boolean {
    if (identity.status !== "ready") {
      if (this.activePageKey === undefined) return false;
      this.activePageKey = undefined;
      this.emit();
      return false;
    }

    const existingRecord = this.recordsByPageKey.get(identity.pageKey);
    let created = false;
    if (existingRecord) {
      existingRecord.pageIdentity = identity;
    } else {
      this.recordsByPageKey.set(
        identity.pageKey,
        this.createRecord(identity, {
          captureMode: options.initialCaptureMode,
          sendMode: options.initialSendMode
        })
      );
      created = true;
    }

    if (this.activePageKey === identity.pageKey) return created;
    this.activePageKey = identity.pageKey;
    this.emit();
    return created;
  }

  updateActiveDraftPrompt(text: string): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord || activeRecord.draftPrompt === text) return;

    activeRecord.draftPrompt = text;
    this.emit();
  }

  updateActiveCaptureMode(captureMode: CaptureMode): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord || activeRecord.captureMode === captureMode) return;

    activeRecord.captureMode = captureMode;
    this.emit();
  }

  updateActiveSendMode(sendMode: SendMode): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord || activeRecord.sendMode === sendMode) return;

    activeRecord.sendMode = sendMode;
    this.emit();
  }

  sendPrompt(prompt?: string): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;

    const promptToSend = prompt ?? activeRecord.draftPrompt;
    const createdAt = new Date().toISOString();
    const pageContext =
      activeRecord.contextAttachments.length > 0
        ? buildContextBundle({
            attachments: activeRecord.contextAttachments,
            metadata: metadataFromPageIdentity(activeRecord.pageIdentity, createdAt),
            createdAt
          })
        : undefined;
    const accepted = pageContext
      ? activeRecord.coordinator.sendPrompt({ prompt: promptToSend, pageContext })
      : activeRecord.coordinator.sendPrompt(promptToSend);
    if (!accepted) return false;

    activeRecord.draftPrompt = "";
    if (pageContext) {
      activeRecord.contextAttachments = [];
      activeRecord.contextState = contextStateForPageContext(pageContext);
    }
    this.emit();
    return true;
  }

  sendPromptWithContext(input: { prompt: string; pageContext: PageContext; userPromptDisplay?: UserPromptDisplay }): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;

    const createdAt = new Date().toISOString();
    const pageContext =
      activeRecord.contextAttachments.length > 0 && isPageContextBase(input.pageContext)
        ? buildContextBundle({
            attachments: activeRecord.contextAttachments,
            metadata: input.pageContext.metadata,
            createdAt,
            pageCaptureContext: input.pageContext
          })
        : input.pageContext;

    const accepted = activeRecord.coordinator.sendPrompt({ ...input, pageContext });
    if (!accepted) return false;

    activeRecord.draftPrompt = "";
    activeRecord.contextAttachments = [];
    activeRecord.contextState = contextStateForPageContext(pageContext);
    activeRecord.sendMode = "send";
    this.emit();
    return true;
  }

  sendPromptWithExternalContextAttachments(input: {
    prompt: string;
    pageContext: PageContext;
    attachments: ComposerContextAttachment[];
    userPromptDisplay?: UserPromptDisplay;
  }): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;

    const createdAt = new Date().toISOString();
    const pageContext =
      input.attachments.length > 0 && isPageContextBase(input.pageContext)
        ? buildContextBundle({
            attachments: input.attachments,
            metadata: input.pageContext.metadata,
            createdAt,
            pageCaptureContext: input.pageContext
          })
        : input.pageContext;
    const accepted = activeRecord.coordinator.sendPrompt({
      prompt: input.prompt,
      pageContext,
      userPromptDisplay: input.userPromptDisplay
    });
    if (!accepted) return false;

    activeRecord.draftPrompt = "";
    activeRecord.contextState = contextStateForPageContext(pageContext);
    activeRecord.sendMode = "send";
    this.emit();
    return true;
  }

  appendActiveContextAttachment(attachment: ComposerContextAttachment): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;
    if (activeRecord.contextAttachments.length >= COMPOSER_CONTEXT_ATTACHMENT_LIMIT) return false;
    if (activeRecord.contextAttachments.some((existingAttachment) => existingAttachment.id === attachment.id)) return false;

    activeRecord.contextAttachments = [...activeRecord.contextAttachments, attachment];
    this.emit();
    return true;
  }

  removeActiveContextAttachment(attachmentId: string): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;
    const nextAttachments = activeRecord.contextAttachments.filter((attachment) => attachment.id !== attachmentId);
    if (nextAttachments.length === activeRecord.contextAttachments.length) return false;

    activeRecord.contextAttachments = nextAttachments;
    this.emit();
    return true;
  }

  clearActiveContextAttachments(): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord || activeRecord.contextAttachments.length === 0) return false;

    activeRecord.contextAttachments = [];
    this.emit();
    return true;
  }

  listActiveContextAttachments(): ComposerContextAttachment[] {
    return [...(this.getActiveRecord()?.contextAttachments ?? [])];
  }

  clearContextAttachmentsForPage(pageKey: PageKey): boolean {
    const record = this.recordsByPageKey.get(pageKey);
    if (!record || record.contextAttachments.length === 0) return false;

    record.contextAttachments = [];
    this.emit();
    return true;
  }

  cancelActiveTurn(): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord?.coordinator.cancelTurn) return false;

    const cancelled = activeRecord.coordinator.cancelTurn();
    this.emit();
    return cancelled;
  }

  recordCaptureUnavailable(input: { message: string }): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return;

    activeRecord.contextState = {
      status: "capture_unavailable",
      label: "Capture unavailable",
      message: input.message
    };
    activeRecord.coordinator.recordCaptureUnavailable?.(input.message);
    this.emit();
  }

  grantActiveSessionApproval(approval: SessionApproval): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return;

    activeRecord.approvals.grant(approval);
  }

  respondToActivePermission(requestId: string, decision: PermissionDecision): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord?.coordinator.respondToPermission) return false;

    const permissionKey = findPendingPermissionKey(activeRecord.coordinator.getSnapshot().transcript, requestId);
    if (!permissionKey) return false;

    const accepted = activeRecord.coordinator.respondToPermission(requestId, decision);
    if (!accepted) return false;

    if (decision === "allow_for_session") {
      activeRecord.approvals.grant({ permissionKey, decision: "allow_for_session" });
    }
    this.emit();
    return true;
  }

  hasActiveSessionApproval(permissionKey: string): boolean {
    return this.getActiveRecord()?.approvals.has(permissionKey) ?? false;
  }

  listActiveSessionApprovals(): SessionApproval[] {
    return this.getActiveRecord()?.approvals.list() ?? [];
  }

  newChat(): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return;

    activeRecord.draftPrompt = "";
    activeRecord.contextAttachments = [];
    activeRecord.contextState = INITIAL_CONTEXT_STATE;
    activeRecord.captureMode = "readable";
    activeRecord.sendMode = "capture";
    activeRecord.approvals.clear();
    activeRecord.coordinator.newChat();
    this.emit();
  }

  markBridgeDisconnected(): void {
    for (const record of this.recordsByPageKey.values()) {
      record.approvals.clear();
      record.contextAttachments = [];
      if (!coordinatorMayHaveProviderState(record.coordinator)) continue;
      record.coordinator.markBridgeDisconnected();
    }
    this.emit();
  }

  clearAllSessions(): void {
    const records = Array.from(this.recordsByPageKey.values());
    this.recordsByPageKey.clear();
    this.activePageKey = undefined;
    this.cachedSnapshot = undefined;

    for (const record of records) {
      record.approvals.clear();
      record.unsubscribeCoordinator();
      if (coordinatorMayHaveProviderState(record.coordinator)) {
        record.coordinator.markBridgeDisconnected();
      }
      record.coordinator.dispose?.();
    }
    this.emit();
  }

  private createRecord(
    identity: Extract<PageIdentity, { status: "ready" }>,
    options: { captureMode?: CaptureMode; sendMode?: SendMode } = {}
  ): UrlSessionRecord {
    const clientSessionId = this.createClientSessionId();
    const coordinator = this.createCoordinator(clientSessionId);
    const record: UrlSessionRecord = {
      pageIdentity: identity,
      clientSessionId,
      captureMode: options.captureMode ?? "readable",
      sendMode: options.sendMode ?? "capture",
      draftPrompt: "",
      contextState: INITIAL_CONTEXT_STATE,
      contextAttachments: [],
      approvals: new InMemorySessionApprovalState(),
      autoApprovalRequestIds: new Set(),
      coordinator,
      unsubscribeCoordinator: () => undefined
    };

    record.unsubscribeCoordinator = coordinator.subscribe(() => {
      this.cachedSnapshot = undefined;
      this.autoAllowApprovedPermissionRequests(record);
      if (this.activePageKey === record.pageIdentity.pageKey) this.emit();
    });

    return record;
  }

  private getActiveRecord(): UrlSessionRecord | undefined {
    return this.activePageKey ? this.recordsByPageKey.get(this.activePageKey) : undefined;
  }

  private autoAllowApprovedPermissionRequests(record: UrlSessionRecord): void {
    if (!record.coordinator.respondToPermission) return;
    for (const entry of record.coordinator.getSnapshot().transcript) {
      if (entry.kind !== "permission_request" || entry.status !== "pending") continue;
      if (!record.approvals.has(entry.permissionKey)) continue;
      if (record.autoApprovalRequestIds.has(entry.requestId)) continue;
      record.autoApprovalRequestIds.add(entry.requestId);
      const accepted = record.coordinator.respondToPermission(entry.requestId, "allow_for_session");
      record.autoApprovalRequestIds.delete(entry.requestId);
      if (!accepted) record.approvals.revoke(entry.permissionKey);
    }
  }

  private snapshotFromRecord(record: UrlSessionRecord): UrlSessionSnapshot {
    const coordinatorSnapshot = record.coordinator.getSnapshot();
    return {
      pageKey: record.pageIdentity.pageKey,
      clientSessionId: record.clientSessionId,
      captureMode: record.captureMode,
      sendMode: record.sendMode,
      draftPrompt: record.draftPrompt,
      contextState: record.contextState,
      contextAttachments: record.contextAttachments.map(snapshotFromAttachment),
      transcript: coordinatorSnapshot.transcript,
      pendingPromptCount: coordinatorSnapshot.pendingPromptCount,
      sessionStarted: coordinatorSnapshot.sessionStarted,
      starting: coordinatorSnapshot.starting,
      turnInFlight: coordinatorSnapshot.turnInFlight,
      canCancelTurn: coordinatorSnapshot.canCancelTurn
    };
  }

  private emit(): void {
    this.cachedSnapshot = undefined;
    for (const listener of this.listeners) listener();
  }
}

class InMemorySessionApprovalState implements SessionApprovalState {
  private readonly approvalsByPermissionKey = new Map<string, SessionApproval>();

  grant(approval: SessionApproval): void {
    this.approvalsByPermissionKey.set(approval.permissionKey, approval);
  }

  revoke(permissionKey: string): void {
    this.approvalsByPermissionKey.delete(permissionKey);
  }

  has(permissionKey: string): boolean {
    return this.approvalsByPermissionKey.has(permissionKey);
  }

  list(): SessionApproval[] {
    return Array.from(this.approvalsByPermissionKey.values());
  }

  clear(): void {
    this.approvalsByPermissionKey.clear();
  }
}

function coordinatorMayHaveProviderState(coordinator: UrlSessionCoordinator): boolean {
  if (coordinator.hasProviderState) return coordinator.hasProviderState();

  const snapshot = coordinator.getSnapshot();
  return snapshot.sessionStarted || snapshot.starting || snapshot.pendingPromptCount > 0;
}

function findPendingPermissionKey(transcript: TranscriptEntry[], requestId: string): string | undefined {
  const entry = transcript.find(
    (candidate) =>
      candidate.kind === "permission_request" &&
      candidate.status === "pending" &&
      candidate.requestId === requestId
  );
  return entry?.kind === "permission_request" ? entry.permissionKey : undefined;
}

function createEmptySessionSnapshot(): UrlSessionSnapshot {
  return {
    pageKey: EMPTY_PAGE_KEY,
    clientSessionId: "",
    captureMode: "readable",
    sendMode: "capture",
    draftPrompt: "",
    contextState: INITIAL_CONTEXT_STATE,
    contextAttachments: [],
    transcript: [],
    pendingPromptCount: 0,
    sessionStarted: false,
    starting: false,
    turnInFlight: false,
    canCancelTurn: false
  };
}

function snapshotFromAttachment(attachment: ComposerContextAttachment): ComposerAttachmentSnapshot {
  return {
    id: attachment.id,
    ...attachment.display
  };
}

function contextStateForPageContext(pageContext: PageContext): ContextState {
  if (pageContext.kind === "context_bundle") {
    const includesPageCapture = pageContext.items.some((item) => item.source === "page_capture");
    return includesPageCapture
      ? {
          status: "page_capture_and_attachments_attached",
          label: "Page capture and attachments attached",
          capturedAt: pageContext.metadata.capturedAt
        }
      : {
          status: "context_attachments_attached",
          label: "Context attachments attached",
          capturedAt: pageContext.metadata.capturedAt
        };
  }

  if (pageContext.kind === "selected_text") {
    return {
      status: "selected_text_attached",
      label: "Selected text attached",
      capturedAt: pageContext.metadata.capturedAt
    };
  }

  if (pageContext.kind === "area_snapshot") {
    return {
      status: "area_snapshot_attached",
      label: "Area snapshot attached",
      capturedAt: pageContext.metadata.capturedAt
    };
  }

  if (pageContext.kind === "metadata_only") {
    if (pageContext.reason === "full_dom_too_large") {
      return {
        status: "full_dom_too_large",
        label: "Full DOM skipped: too large",
        capturedAt: pageContext.metadata.capturedAt,
        reason: pageContext.reason
      };
    }

    if (pageContext.reason === "content_too_large") {
      return {
        status: "content_too_large",
        label: "Content too large",
        capturedAt: pageContext.metadata.capturedAt,
        reason: pageContext.reason
      };
    }

    if (pageContext.reason === "selection_too_large") {
      return {
        status: "selection_too_large",
        label: "Selection too large",
        capturedAt: pageContext.metadata.capturedAt,
        reason: pageContext.reason
      };
    }

    return {
      status: "metadata_only",
      label: "Metadata attached",
      capturedAt: pageContext.metadata.capturedAt,
      reason: pageContext.reason
    };
  }

  if (pageContext.kind === "full_dom") {
    return {
      status: "full_dom_attached",
      label: "Full DOM attached",
      capturedAt: pageContext.metadata.capturedAt
    };
  }

  return {
    status: "attached",
    label: "Context attached",
    capturedAt: pageContext.metadata.capturedAt
  };
}
