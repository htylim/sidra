import type { SafeAgentActivity } from "@sidra/protocol";

export type SafeActivityEntry = SafeAgentActivity;

export type UserMessageEntry = {
  id?: string;
  kind: "user_message";
  role: "user";
  text: string;
};

export type AssistantTurnEntry = {
  id?: string;
  kind: "assistant_turn";
  role: "assistant";
  markdown: string;
  text: string;
  activity: SafeActivityEntry[];
  status: "streaming" | "complete" | "cancelled" | "failed";
};

export type StatusEntry = {
  id?: string;
  kind: "status";
  role: "status";
  tone: "neutral" | "error" | "cancelled";
  text: string;
};

export type TranscriptEntry = UserMessageEntry | AssistantTurnEntry | StatusEntry;
type TranscriptEntryInput =
  | Omit<UserMessageEntry, "id">
  | Omit<AssistantTurnEntry, "id">
  | Omit<StatusEntry, "id">;

export type ContextAttachmentMarker =
  | { kind: "page_context_attached"; text: "Page context attached" }
  | { kind: "full_dom_attached"; text: "Full DOM attached" }
  | { kind: "full_dom_too_large"; text: "Full DOM skipped; content too large" }
  | { kind: "page_metadata_attached"; text: "Page metadata attached" }
  | { kind: "page_metadata_content_too_large"; text: "Page metadata attached; content too large" };

export function addUserPrompt(
  transcript: TranscriptEntry[],
  prompt: string,
  id?: string
): TranscriptEntry[] {
  return [...transcript, transcriptEntry({ kind: "user_message", role: "user", text: prompt.trim() }, id)];
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
    activity: [...currentTurn.activity, activity]
  }));
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
  id?: string
): TranscriptEntry[] {
  return [...transcript, transcriptEntry({ kind: "status", role: "status", tone: "neutral", text }, id)];
}

export function addErrorStatusEntry(
  transcript: TranscriptEntry[],
  text: string,
  id?: string
): TranscriptEntry[] {
  return [...transcript, transcriptEntry({ kind: "status", role: "status", tone: "error", text }, id)];
}

export function addContextMarker(
  transcript: TranscriptEntry[],
  marker: ContextAttachmentMarker,
  id: string
): TranscriptEntry[] {
  return addStatusEntry(transcript, marker.text, id);
}

export function removeTranscriptEntriesByIds(
  transcript: TranscriptEntry[],
  entryIds: ReadonlySet<string>
): TranscriptEntry[] {
  if (entryIds.size === 0) return transcript;
  return transcript.filter((entry) => !entry.id || !entryIds.has(entry.id));
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

function updateCurrentAssistantTurn(
  transcript: TranscriptEntry[],
  update: (currentTurn: AssistantTurnEntry) => AssistantTurnEntry
): TranscriptEntry[] {
  const currentAssistantTurnIndex = findLatestAssistantTurnIndexAfterLatestUser(transcript);
  if (currentAssistantTurnIndex === -1) {
    return [...transcript, update(createAssistantTurn())];
  }

  const currentEntry = transcript[currentAssistantTurnIndex];
  if (currentEntry?.kind !== "assistant_turn" || currentEntry.status !== "streaming") {
    return [...transcript, update(createAssistantTurn())];
  }

  return replaceTranscriptEntry(transcript, currentAssistantTurnIndex, update(currentEntry));
}

function setCurrentAssistantTurnStatus(
  transcript: TranscriptEntry[],
  status: AssistantTurnEntry["status"]
): TranscriptEntry[] {
  const currentAssistantTurnIndex = findLatestAssistantTurnIndexAfterLatestUser(transcript);
  if (currentAssistantTurnIndex === -1) return transcript;

  const currentEntry = transcript[currentAssistantTurnIndex];
  if (currentEntry?.kind !== "assistant_turn" || currentEntry.status !== "streaming") return transcript;
  return replaceTranscriptEntry(transcript, currentAssistantTurnIndex, { ...currentEntry, status });
}

function createAssistantTurn(): AssistantTurnEntry {
  return {
    kind: "assistant_turn",
    role: "assistant",
    markdown: "",
    text: "",
    activity: [],
    status: "streaming"
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
