import { describe, expect, it } from "vitest";
import {
  addAssistantTextDelta,
  addContextMarker,
  addStatusEntry,
  addUserPrompt,
  type TranscriptEntry
} from "./transcript";

describe("transcript reducer", () => {
  it("adds escaped user prompt entries", () => {
    const transcript: TranscriptEntry[] = [];

    expect(addUserPrompt(transcript, "  <script>alert(1)</script>  ")).toEqual([
      { role: "user", text: "<script>alert(1)</script>" }
    ]);
  });

  it("adds assistant text delta entries", () => {
    const transcript: TranscriptEntry[] = [{ role: "user", text: "hello" }];

    expect(addAssistantTextDelta(transcript, "Hi")).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "Hi" }
    ]);
  });

  it("appends consecutive assistant text deltas to the current assistant entry", () => {
    const transcript: TranscriptEntry[] = addAssistantTextDelta(
      addAssistantTextDelta([{ role: "user", text: "hello" }], "Hi"),
      " there"
    );

    expect(transcript).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "Hi there" }
    ]);
  });

  it("adds operational status entries", () => {
    const transcript: TranscriptEntry[] = [];

    expect(addStatusEntry(transcript, "Session started")).toEqual([
      { role: "status", text: "Session started" }
    ]);
  });

  it("adds_status_marker_without_raw_page_content", () => {
    const transcript: TranscriptEntry[] = [];

    const nextTranscript = addContextMarker(
      transcript,
      { kind: "page_context_attached", text: "Page context attached" },
      "marker-1"
    );

    expect(nextTranscript).toEqual([{ role: "status", text: "Page context attached" }]);
    expect(nextTranscript[0].id).toBe("marker-1");
  });
});
