export type TranscriptEntry = { role: "user" | "assistant" | "status"; text: string };

export function addUserPrompt(transcript: TranscriptEntry[], prompt: string): TranscriptEntry[] {
  return [...transcript, { role: "user", text: prompt.trim() }];
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

export function addStatusEntry(transcript: TranscriptEntry[], text: string): TranscriptEntry[] {
  return [...transcript, { role: "status", text }];
}
