import type { PermissionDecision, PermissionRequest, SafeAgentActivity } from "@sidra/protocol";
import type { ContextAttachmentDisplay } from "./context-attachment-display";

export type SafeActivityEntry = SafeAgentActivity;

export type CommandOutputEntry = {
  stream: "stdout" | "stderr" | "unknown";
  text: string;
};

export type ToolActivityEntry = Extract<SafeAgentActivity, { kind: "tool" }> & {
  commandOutput: CommandOutputEntry[];
};

export type TranscriptActivity = {
  reasoningSummary: string;
  tools: ToolActivityEntry[];
};

export type UserMessageEntry = {
  id?: string;
  kind: "user_message";
  role: "user";
  text: string;
  display?: UserPromptDisplay;
};

export type UserPromptDisplay =
  | { kind: "plain" }
  | { kind: "quick_action"; label: string };

export type AssistantTurnEntry = {
  id?: string;
  kind: "assistant_turn";
  role: "assistant";
  markdown: string;
  text: string;
  activity: TranscriptActivity;
  status: "streaming" | "complete" | "cancelled" | "failed";
};

export type StatusEntry = {
  id?: string;
  kind: "status";
  role: "status";
  tone: "neutral" | "error" | "cancelled";
  text: string;
  contextAttachments?: ContextAttachmentDisplay[];
};

export type PermissionRequestStatus = "pending" | "unavailable";

export type PermissionRequestEntry = {
  id?: string;
  kind: "permission_request";
  role: "permission";
  text?: never;
  requestId: string;
  permissionKey: string;
  title: string;
  description?: string;
  metadata?: PermissionRequest["metadata"];
  status: PermissionRequestStatus;
};

export type TranscriptEntry = UserMessageEntry | AssistantTurnEntry | StatusEntry | PermissionRequestEntry;
type TranscriptEntryInput =
  | Omit<UserMessageEntry, "id">
  | Omit<AssistantTurnEntry, "id">
  | Omit<StatusEntry, "id">
  | Omit<PermissionRequestEntry, "id">;

let nextAssistantTurnId = 0;

type ContextAttachmentMarkerDetails = {
  contextAttachments?: ContextAttachmentDisplay[];
};

export type ContextAttachmentMarker = ContextAttachmentMarkerDetails &
  (
    | { kind: "page_context_attached"; text: "Page context attached" }
    | { kind: "full_dom_attached"; text: "Full DOM attached" }
    | { kind: "full_dom_too_large"; text: "Full DOM skipped; content too large" }
    | { kind: "page_metadata_attached"; text: "Page metadata attached" }
    | { kind: "page_metadata_content_too_large"; text: "Page metadata attached; content too large" }
    | { kind: "selected_text_attached"; text: "Selected text attached" }
    | { kind: "selected_text_too_large"; text: "Selected text skipped; content too large" }
    | { kind: "area_snapshot_attached"; text: "Area snapshot attached" }
    | { kind: "context_attachments_attached"; text: "Context attachments attached" }
    | { kind: "page_capture_and_attachments_attached"; text: "Page capture and attachments attached" }
  );

export function addUserPrompt(
  transcript: TranscriptEntry[],
  prompt: string,
  id?: string,
  display?: UserPromptDisplay
): TranscriptEntry[] {
  return [
    ...transcript,
    transcriptEntry(
      {
        kind: "user_message",
        role: "user",
        text: prompt.trim(),
        ...(normalizeUserPromptDisplay(display) ? { display: normalizeUserPromptDisplay(display) } : {})
      },
      id
    )
  ];
}

export function addAssistantTextDelta(transcript: TranscriptEntry[], text: string): TranscriptEntry[] {
  return updateCurrentAssistantTurn(transcript, (currentTurn) => {
    const markdown = currentTurn.markdown + text;
    return { ...currentTurn, markdown, text: markdown };
  });
}

export function addAssistantActivity(transcript: TranscriptEntry[], activity: SafeActivityEntry): TranscriptEntry[] {
  return updateCurrentAssistantTurn(transcript, (currentTurn) => ({
    ...currentTurn,
    activity: addActivityToState(currentTurn.activity, activity)
  }));
}

export function hasVisibleActivity(activity: TranscriptActivity): boolean {
  return activity.reasoningSummary.trim().length > 0 || activity.tools.length > 0;
}

export function completeAssistantTurn(transcript: TranscriptEntry[]): TranscriptEntry[] {
  return setCurrentAssistantTurnStatus(transcript, "complete");
}

export function cancelAssistantTurn(transcript: TranscriptEntry[]): TranscriptEntry[] {
  const nextTranscript = setCurrentAssistantTurnStatus(transcript, "cancelled");
  if (nextTranscript === transcript) return transcript;
  return [...nextTranscript, { kind: "status", role: "status", tone: "cancelled", text: "Assistant turn cancelled" }];
}

export function failAssistantTurn(transcript: TranscriptEntry[]): TranscriptEntry[] {
  return setCurrentAssistantTurnStatus(transcript, "failed");
}

export function addStatusEntry(
  transcript: TranscriptEntry[],
  text: string,
  id?: string,
  contextAttachments?: ContextAttachmentDisplay[]
): TranscriptEntry[] {
  return [
    ...transcript,
    transcriptEntry(
      {
        kind: "status",
        role: "status",
        tone: "neutral",
        text,
        ...(contextAttachments?.length ? { contextAttachments } : {})
      },
      id
    )
  ];
}

export function addErrorStatusEntry(
  transcript: TranscriptEntry[],
  text: string,
  id?: string
): TranscriptEntry[] {
  return [...transcript, transcriptEntry({ kind: "status", role: "status", tone: "error", text }, id)];
}

export function addPermissionRequest(
  transcript: TranscriptEntry[],
  request: PermissionRequest,
  id?: string
): TranscriptEntry[] {
  const transcriptWithClosedAssistantSegment = completeAssistantTurn(transcript);
  const entry: Omit<PermissionRequestEntry, "id"> = {
    kind: "permission_request",
    role: "permission",
    requestId: request.requestId,
    permissionKey: request.permissionKey,
    title: request.title,
    status: "pending"
  };
  if (request.description !== undefined) entry.description = request.description;
  if (request.metadata !== undefined) entry.metadata = request.metadata;
  return [...transcriptWithClosedAssistantSegment, transcriptEntry(entry, id)];
}

export function resolvePermissionRequest(
  transcript: TranscriptEntry[],
  requestId: string,
  _decision: PermissionDecision
): TranscriptEntry[] {
  return removePendingPermissionRequest(transcript, requestId);
}

export function markPendingPermissionRequestsUnavailable(transcript: TranscriptEntry[]): TranscriptEntry[] {
  let changed = false;
  const nextTranscript = transcript.map((entry) => {
    if (entry.kind !== "permission_request" || entry.status !== "pending") return entry;
    changed = true;
    return { ...entry, status: "unavailable" as const };
  });
  return changed ? nextTranscript : transcript;
}

export function addContextMarker(
  transcript: TranscriptEntry[],
  marker: ContextAttachmentMarker,
  id: string
): TranscriptEntry[] {
  return addStatusEntry(transcript, marker.text, id, marker.contextAttachments);
}

export function removeTranscriptEntriesByIds(
  transcript: TranscriptEntry[],
  entryIds: ReadonlySet<string>
): TranscriptEntry[] {
  if (entryIds.size === 0) return transcript;
  return transcript.filter((entry) => !entry.id || !entryIds.has(entry.id));
}

function removePendingPermissionRequest(
  transcript: TranscriptEntry[],
  requestId: string
): TranscriptEntry[] {
  const index = transcript.findIndex((entry) => entry.kind === "permission_request" && entry.requestId === requestId);
  const entry = transcript[index];
  if (index === -1 || entry?.kind !== "permission_request" || entry.status !== "pending") return transcript;
  return [...transcript.slice(0, index), ...transcript.slice(index + 1)];
}

function transcriptEntry(
  entry: TranscriptEntryInput,
  id?: string
): TranscriptEntry {
  if (!id) return entry;

  return Object.defineProperty(entry, "id", {
    value: id,
    enumerable: false
  }) as TranscriptEntry;
}

function normalizeUserPromptDisplay(display: UserPromptDisplay | undefined): UserPromptDisplay | undefined {
  if (!display || display.kind === "plain") return undefined;
  const label = display.label.trim();
  return label ? { kind: "quick_action", label } : undefined;
}

function updateCurrentAssistantTurn(
  transcript: TranscriptEntry[],
  update: (currentTurn: AssistantTurnEntry) => AssistantTurnEntry
): TranscriptEntry[] {
  const currentAssistantTurnIndex = findLatestAssistantTurnIndexAfterLatestUser(transcript);
  if (currentAssistantTurnIndex === -1) {
    const nextTurn = createAssistantTurn();
    return [...transcript, preserveTranscriptEntryId(nextTurn, update(nextTurn))];
  }

  const currentEntry = transcript[currentAssistantTurnIndex];
  if (currentEntry?.kind !== "assistant_turn" || currentEntry.status !== "streaming") {
    const nextTurn = createAssistantTurn();
    return [...transcript, preserveTranscriptEntryId(nextTurn, update(nextTurn))];
  }

  return replaceTranscriptEntry(transcript, currentAssistantTurnIndex, preserveTranscriptEntryId(currentEntry, update(currentEntry)));
}

function setCurrentAssistantTurnStatus(
  transcript: TranscriptEntry[],
  status: AssistantTurnEntry["status"]
): TranscriptEntry[] {
  const currentAssistantTurnIndex = findLatestAssistantTurnIndexAfterLatestUser(transcript);
  if (currentAssistantTurnIndex === -1) return transcript;

  const currentEntry = transcript[currentAssistantTurnIndex];
  if (currentEntry?.kind !== "assistant_turn" || currentEntry.status !== "streaming") return transcript;
  return replaceTranscriptEntry(
    transcript,
    currentAssistantTurnIndex,
    preserveTranscriptEntryId(currentEntry, { ...currentEntry, status })
  );
}

function createAssistantTurn(): AssistantTurnEntry {
  return transcriptEntry(
    {
      kind: "assistant_turn",
      role: "assistant",
      markdown: "",
      text: "",
      activity: createEmptyActivity(),
      status: "streaming"
    },
    nextGeneratedAssistantTurnId()
  ) as AssistantTurnEntry;
}

function preserveTranscriptEntryId<TEntry extends TranscriptEntry>(previousEntry: TranscriptEntry, nextEntry: TEntry): TEntry {
  return previousEntry.id ? (transcriptEntry(nextEntry, previousEntry.id) as TEntry) : nextEntry;
}

function nextGeneratedAssistantTurnId(): string {
  nextAssistantTurnId += 1;
  return `assistant-turn-${nextAssistantTurnId}`;
}

function createEmptyActivity(): TranscriptActivity {
  return { reasoningSummary: "", tools: [] };
}

function addActivityToState(state: TranscriptActivity, activity: SafeActivityEntry): TranscriptActivity {
  switch (activity.kind) {
    case "reasoning_summary_delta":
      return { ...state, reasoningSummary: state.reasoningSummary + activity.text };
    case "tool":
      return addToolActivity(state, activity);
    case "command_output_delta":
      return addCommandOutput(state, activity);
  }
}

function addToolActivity(state: TranscriptActivity, activity: Extract<SafeAgentActivity, { kind: "tool" }>): TranscriptActivity {
  const existingIndex = state.tools.findIndex((tool) => tool.itemId === activity.itemId);
  const existingTool = existingIndex === -1 ? undefined : state.tools[existingIndex];
  const nextTool: ToolActivityEntry = {
    ...activity,
    details: activity.details.length > 0 ? activity.details : (existingTool?.details ?? []),
    commandOutput: existingTool?.commandOutput ?? []
  };

  if (existingIndex === -1) {
    return { ...state, tools: [...state.tools, nextTool] };
  }

  return {
    ...state,
    tools: state.tools.map((tool, index) => (index === existingIndex ? nextTool : tool))
  };
}

function addCommandOutput(
  state: TranscriptActivity,
  activity: Extract<SafeAgentActivity, { kind: "command_output_delta" }>
): TranscriptActivity {
  const existingIndex = state.tools.findIndex((tool) => tool.itemId === activity.itemId && tool.toolKind === "command");
  if (existingIndex === -1) return state;

  return {
    ...state,
    tools: state.tools.map((tool, index) =>
      index === existingIndex
        ? { ...tool, commandOutput: [...tool.commandOutput, { stream: activity.stream, text: activity.text }] }
        : tool
    )
  };
}

function findLatestAssistantTurnIndexAfterLatestUser(transcript: TranscriptEntry[]): number {
  let latestUserMessageIndex = -1;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index]?.kind === "user_message") {
      latestUserMessageIndex = index;
      break;
    }
  }

  for (let index = transcript.length - 1; index > latestUserMessageIndex; index -= 1) {
    if (transcript[index]?.kind === "assistant_turn") return index;
  }
  return -1;
}

function replaceTranscriptEntry(
  transcript: TranscriptEntry[],
  index: number,
  entry: TranscriptEntry
): TranscriptEntry[] {
  return [...transcript.slice(0, index), entry, ...transcript.slice(index + 1)];
}
