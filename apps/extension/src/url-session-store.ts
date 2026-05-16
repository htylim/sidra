import type { PageContext } from "@sidra/protocol";
import type { BridgeSessionCoordinatorSnapshot } from "./bridge/session-coordinator";
import type { PageIdentity, PageKey } from "./page-key";
import type { TranscriptEntry } from "./transcript";

export type ContextState =
  | { status: "none"; label: "No context sent yet" }
  | { status: "attached"; label: "Context attached"; capturedAt: string }
  | {
      status: "metadata_only";
      label: "Metadata attached";
      capturedAt: string;
      reason: "no_usable_text";
    }
  | { status: "capture_unavailable"; label: "Capture unavailable"; message: string };

export type UrlSessionSnapshot = {
  pageKey: PageKey;
  clientSessionId: string;
  draftPrompt: string;
  contextState: ContextState;
  transcript: TranscriptEntry[];
  pendingPromptCount: number;
  sessionStarted: boolean;
  starting: boolean;
};

type UrlSessionRecord = {
  pageIdentity: Extract<PageIdentity, { status: "ready" }>;
  clientSessionId: string;
  draftPrompt: string;
  contextState: ContextState;
  coordinator: UrlSessionCoordinator;
};

export type UrlSessionCoordinator = {
  getSnapshot(): BridgeSessionCoordinatorSnapshot;
  subscribe(listener: () => void): () => void;
  sendPrompt(input: string | { prompt: string; pageContext?: PageContext }): boolean;
  recordCaptureUnavailable?(message: string): void;
  newChat(): void;
  markBridgeDisconnected(): void;
  hasProviderState?(): boolean;
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

  selectPage(identity: PageIdentity): void {
    if (identity.status !== "ready") {
      if (this.activePageKey === undefined) return;
      this.activePageKey = undefined;
      this.emit();
      return;
    }

    const existingRecord = this.recordsByPageKey.get(identity.pageKey);
    if (existingRecord) {
      existingRecord.pageIdentity = identity;
    } else {
      this.recordsByPageKey.set(identity.pageKey, this.createRecord(identity));
    }

    if (this.activePageKey === identity.pageKey) return;
    this.activePageKey = identity.pageKey;
    this.emit();
  }

  updateActiveDraftPrompt(text: string): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord || activeRecord.draftPrompt === text) return;

    activeRecord.draftPrompt = text;
    this.emit();
  }

  sendPrompt(prompt?: string): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;

    const promptToSend = prompt ?? activeRecord.draftPrompt;
    const accepted = activeRecord.coordinator.sendPrompt(promptToSend);
    if (!accepted) return false;

    activeRecord.draftPrompt = "";
    this.emit();
    return true;
  }

  sendPromptWithContext(input: { prompt: string; pageContext: PageContext }): boolean {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return false;

    const accepted = activeRecord.coordinator.sendPrompt(input);
    if (!accepted) return false;

    activeRecord.draftPrompt = "";
    activeRecord.contextState = contextStateForPageContext(input.pageContext);
    this.emit();
    return true;
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

  newChat(): void {
    const activeRecord = this.getActiveRecord();
    if (!activeRecord) return;

    activeRecord.draftPrompt = "";
    activeRecord.contextState = INITIAL_CONTEXT_STATE;
    activeRecord.coordinator.newChat();
    this.emit();
  }

  markBridgeDisconnected(): void {
    for (const record of this.recordsByPageKey.values()) {
      if (!coordinatorMayHaveProviderState(record.coordinator)) continue;
      record.coordinator.markBridgeDisconnected();
    }
    this.emit();
  }

  private createRecord(identity: Extract<PageIdentity, { status: "ready" }>): UrlSessionRecord {
    const clientSessionId = this.createClientSessionId();
    const coordinator = this.createCoordinator(clientSessionId);
    const record: UrlSessionRecord = {
      pageIdentity: identity,
      clientSessionId,
      draftPrompt: "",
      contextState: INITIAL_CONTEXT_STATE,
      coordinator
    };

    coordinator.subscribe(() => {
      this.cachedSnapshot = undefined;
      if (this.activePageKey === record.pageIdentity.pageKey) this.emit();
    });

    return record;
  }

  private getActiveRecord(): UrlSessionRecord | undefined {
    return this.activePageKey ? this.recordsByPageKey.get(this.activePageKey) : undefined;
  }

  private snapshotFromRecord(record: UrlSessionRecord): UrlSessionSnapshot {
    const coordinatorSnapshot = record.coordinator.getSnapshot();
    return {
      pageKey: record.pageIdentity.pageKey,
      clientSessionId: record.clientSessionId,
      draftPrompt: record.draftPrompt,
      contextState: record.contextState,
      transcript: coordinatorSnapshot.transcript,
      pendingPromptCount: coordinatorSnapshot.pendingPromptCount,
      sessionStarted: coordinatorSnapshot.sessionStarted,
      starting: coordinatorSnapshot.starting
    };
  }

  private emit(): void {
    this.cachedSnapshot = undefined;
    for (const listener of this.listeners) listener();
  }
}

function coordinatorMayHaveProviderState(coordinator: UrlSessionCoordinator): boolean {
  if (coordinator.hasProviderState) return coordinator.hasProviderState();

  const snapshot = coordinator.getSnapshot();
  return snapshot.sessionStarted || snapshot.starting || snapshot.pendingPromptCount > 0;
}

function createEmptySessionSnapshot(): UrlSessionSnapshot {
  return {
    pageKey: EMPTY_PAGE_KEY,
    clientSessionId: "",
    draftPrompt: "",
    contextState: INITIAL_CONTEXT_STATE,
    transcript: [],
    pendingPromptCount: 0,
    sessionStarted: false,
    starting: false
  };
}

function contextStateForPageContext(pageContext: PageContext): ContextState {
  if (pageContext.kind === "metadata_only") {
    return {
      status: "metadata_only",
      label: "Metadata attached",
      capturedAt: pageContext.metadata.capturedAt,
      reason: pageContext.reason
    };
  }

  return {
    status: "attached",
    label: "Context attached",
    capturedAt: pageContext.metadata.capturedAt
  };
}
