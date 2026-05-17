export type TranscriptEntry = { id?: string; role: "user" | "assistant" | "status"; text: string };

export type ContextAttachmentMarker =
  | { kind: "page_context_attached"; text: "Page context attached" }
  | { kind: "page_metadata_attached"; text: "Page metadata attached" }
  | { kind: "page_metadata_content_too_large"; text: "Page metadata attached; content too large" }
  | { kind: "capture_unavailable"; text: "Could not capture this page" };

export function addUserPrompt(
  transcript: TranscriptEntry[],
  prompt: string,
  id?: string
): TranscriptEntry[] {
  return [...transcript, transcriptEntry({ role: "user", text: prompt.trim() }, id)];
}

export function addAssistantTextDelta(transcript: TranscriptEntry[], text: string): TranscriptEntry[] {
  const currentEntry = transcript.at(-1);
  if (currentEntry?.role !== "assistant") {
    return [...transcript, { role: "assistant", text }];
  }

  return [
    ...transcript.slice(0, -1),
    {
      ...currentEntry,
      text: currentEntry.text + text
    }
  ];
}

export function addStatusEntry(
  transcript: TranscriptEntry[],
  text: string,
  id?: string
): TranscriptEntry[] {
  return [...transcript, transcriptEntry({ role: "status", text }, id)];
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
  entry: Omit<TranscriptEntry, "id">,
  id?: string
): TranscriptEntry {
  if (!id) return entry;

  return Object.defineProperty(entry, "id", {
    value: id,
    enumerable: false
  }) as TranscriptEntry;
}
