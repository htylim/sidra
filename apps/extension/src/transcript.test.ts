import { describe, expect, it } from "vitest";
import {
  addAssistantActivity,
  addAssistantTextDelta,
  addContextMarker,
  addErrorStatusEntry,
  addPermissionRequest,
  addStatusEntry,
  addUserPrompt,
  cancelAssistantTurn,
  completeAssistantTurn,
  failAssistantTurn,
  markPendingPermissionRequestsUnavailable,
  removeTranscriptEntriesByIds,
  resolvePermissionRequest,
  type SafeActivityEntry,
  type TranscriptEntry
} from "./transcript";

describe("transcript reducer", () => {
  describe("rich transcript reducer", () => {
    it("adds_user_prompt_entries_as_user_message_variants", () => {
      expect(addUserPrompt([], "  <script>alert(1)</script>  ")).toEqual([
        { kind: "user_message", role: "user", text: "<script>alert(1)</script>" }
      ]);
    });

    it("appends_assistant_text_deltas_to_a_streaming_turn", () => {
      const transcript = addAssistantTextDelta(addAssistantTextDelta([], "Hi"), " there");

      expect(transcript).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Hi there",
          text: "Hi there",
          activity: [],
          status: "streaming"
        }
      ]);
    });

    it("starts_a_new_assistant_turn_after_a_user_message", () => {
      const transcript = addAssistantTextDelta(addUserPrompt(addAssistantTextDelta([], "Previous"), "next"), "New");

      expect(transcript).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Previous",
          text: "Previous",
          activity: [],
          status: "streaming"
        },
        { kind: "user_message", role: "user", text: "next" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "New",
          text: "New",
          activity: [],
          status: "streaming"
        }
      ]);
    });

    it("marks_current_assistant_turn_complete_on_done", () => {
      expect(completeAssistantTurn(addAssistantTextDelta([], "Done"))).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Done",
          text: "Done",
          activity: [],
          status: "complete"
        }
      ]);
    });

    it("marks_current_assistant_turn_cancelled_without_removing_partial_text", () => {
      expect(cancelAssistantTurn(addAssistantTextDelta([], "Partial"))[0]).toMatchObject({
        kind: "assistant_turn",
        markdown: "Partial",
        text: "Partial",
        status: "cancelled"
      });
    });

    it("appends_cancelled_status_card_when_assistant_cancelled_arrives", () => {
      expect(cancelAssistantTurn(addAssistantTextDelta([], "Partial"))).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Partial",
          text: "Partial",
          activity: [],
          status: "cancelled"
        },
        { kind: "status", role: "status", tone: "cancelled", text: "Assistant turn cancelled" }
      ]);
    });

    it("does_not_create_blank_assistant_turns_for_terminal_events_without_a_current_turn", () => {
      expect(completeAssistantTurn([])).toEqual([]);
      expect(failAssistantTurn([])).toEqual([]);
      expect(cancelAssistantTurn([])).toEqual([]);
      expect(completeAssistantTurn(addUserPrompt([], "next"))).toEqual([
        { kind: "user_message", role: "user", text: "next" }
      ]);
    });

    it("marks_current_assistant_turn_failed_without_removing_partial_text", () => {
      expect(failAssistantTurn(addAssistantTextDelta([], "Partial"))).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Partial",
          text: "Partial",
          activity: [],
          status: "failed"
        }
      ]);
    });

    it("keeps_terminal_assistant_turn_statuses_immutable", () => {
      const completeTurn = completeAssistantTurn(addAssistantTextDelta([], "Complete"));
      const failedTurn = failAssistantTurn(addAssistantTextDelta([], "Failed"));

      expect(failAssistantTurn(completeTurn)).toEqual(completeTurn);
      expect(completeAssistantTurn(failedTurn)).toEqual(failedTurn);
      expect(cancelAssistantTurn(completeTurn)).toEqual(completeTurn);
    });

    it("starts_new_streaming_turns_when_text_or_activity_arrives_after_terminal_turns", () => {
      const activity: SafeActivityEntry = { kind: "progress", label: "Working" };
      const completeTurn = completeAssistantTurn(addAssistantTextDelta([], "Done"));

      expect(addAssistantTextDelta(completeTurn, "Next")).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Done",
          text: "Done",
          activity: [],
          status: "complete"
        },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Next",
          text: "Next",
          activity: [],
          status: "streaming"
        }
      ]);
      expect(addAssistantActivity(completeTurn, activity).at(-1)).toEqual({
        kind: "assistant_turn",
        role: "assistant",
        markdown: "",
        text: "",
        activity: [activity],
        status: "streaming"
      });
    });

    it("adds_safe_activity_to_the_current_assistant_turn", () => {
      const activity: SafeActivityEntry = { kind: "progress", label: "Reading" };

      expect(addAssistantActivity(addAssistantTextDelta([], "Working"), activity)).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Working",
          text: "Working",
          activity: [activity],
          status: "streaming"
        }
      ]);
    });

    it("updates_streaming_assistant_turns_when_status_entries_follow_them", () => {
      const transcript = addStatusEntry(addAssistantTextDelta([], "Partial"), "Bridge is slow");

      expect(completeAssistantTurn(addAssistantTextDelta(transcript, " output"))).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Partial output",
          text: "Partial output",
          activity: [],
          status: "complete"
        },
        { kind: "status", role: "status", tone: "neutral", text: "Bridge is slow" }
      ]);
    });

    it("starts_new_assistant_turns_after_status_entries_when_latest_turn_is_terminal", () => {
      const transcript = addStatusEntry(completeAssistantTurn(addAssistantTextDelta([], "Done")), "Session started");

      expect(addAssistantTextDelta(transcript, "Next")).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Done",
          text: "Done",
          activity: [],
          status: "complete"
        },
        { kind: "status", role: "status", tone: "neutral", text: "Session started" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Next",
          text: "Next",
          activity: [],
          status: "streaming"
        }
      ]);
    });

    it("creates_an_assistant_turn_for_activity_before_text", () => {
      const activity: SafeActivityEntry = { kind: "tool", phase: "started", label: "Tool started" };

      expect(addAssistantActivity([], activity)).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "",
          text: "",
          activity: [activity],
          status: "streaming"
        }
      ]);
    });

    it("records_session_error_as_error_status_entry", () => {
      expect(addErrorStatusEntry([], "Provider failed")).toEqual([
        { kind: "status", role: "status", tone: "error", text: "Provider failed" }
      ]);
    });

    it("keeps_context_attachment_markers_as_neutral_status_entries", () => {
      const transcript = addContextMarker([], { kind: "page_context_attached", text: "Page context attached" }, "marker-1");

      expect(transcript).toEqual([
        { kind: "status", role: "status", tone: "neutral", text: "Page context attached" }
      ]);
      expect(transcript[0]?.id).toBe("marker-1");
    });

    it("records_capture_unavailable_as_error_status_entry", () => {
      const transcript = addErrorStatusEntry([], "Could not capture this page", "capture-1");

      expect(transcript).toEqual([
        { kind: "status", role: "status", tone: "error", text: "Could not capture this page" }
      ]);
      expect(transcript[0]?.id).toBe("capture-1");
    });

    it("removes_transcript_entries_by_hidden_ids_after_the_entry_shape_changes", () => {
      const transcript = addStatusEntry(addUserPrompt([], "hello", "prompt-1"), "Session started", "status-1");

      expect(Object.keys(transcript[0] ?? {})).not.toContain("id");
      expect(transcript[0]?.id).toBe("prompt-1");
      expect(removeTranscriptEntriesByIds(transcript, new Set(["prompt-1"]))).toEqual([
        { kind: "status", role: "status", tone: "neutral", text: "Session started" }
      ]);
    });

    it("adds_pending_permission_request_entry_after_latest_user_turn", () => {
      const transcript = addPermissionRequest(addUserPrompt([], "run it"), {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command",
        description: "Allow command",
        metadata: { toolName: "shell", commandPreview: "ls" }
      });

      expect(transcript).toEqual([
        { kind: "user_message", role: "user", text: "run it" },
        {
          kind: "permission_request",
          role: "permission",
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command",
          description: "Allow command",
          metadata: { toolName: "shell", commandPreview: "ls" },
          status: "pending"
        }
      ]);
    });

    it("closes_current_assistant_segment_before_permission_request", () => {
      const transcript = addPermissionRequest(addAssistantTextDelta(addUserPrompt([], "run it"), "Checking"), {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(transcript).toEqual([
        { kind: "user_message", role: "user", text: "run it" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Checking",
          text: "Checking",
          activity: [],
          status: "complete"
        },
        {
          kind: "permission_request",
          role: "permission",
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command",
          status: "pending"
        }
      ]);
    });

    it("keeps_post_permission_output_after_permission_card", () => {
      const permissionTranscript = resolvePermissionRequest(
        addPermissionRequest(addAssistantTextDelta(addUserPrompt([], "run it"), "Checking"), {
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command"
        }),
        "permission-1",
        "allow_once"
      );
      const transcript = addAssistantActivity(addAssistantTextDelta(permissionTranscript, "Allowed"), {
        kind: "tool",
        phase: "started",
        label: "Tool started"
      });

      expect(transcript).toEqual([
        { kind: "user_message", role: "user", text: "run it" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Checking",
          text: "Checking",
          activity: [],
          status: "complete"
        },
        {
          kind: "permission_request",
          role: "permission",
          requestId: "permission-1",
          permissionKey: "shell:ls",
          title: "Run command",
          status: "allowed_once"
        },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Allowed",
          text: "Allowed",
          activity: [{ kind: "tool", phase: "started", label: "Tool started" }],
          status: "streaming"
        }
      ]);
    });

    it("marks_permission_request_allowed_once", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(resolvePermissionRequest(transcript, "permission-1", "allow_once")).toContainEqual(
        expect.objectContaining({ kind: "permission_request", status: "allowed_once" })
      );
    });

    it("marks_permission_request_allowed_for_session", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(resolvePermissionRequest(transcript, "permission-1", "allow_for_session")).toContainEqual(
        expect.objectContaining({ kind: "permission_request", status: "allowed_for_session" })
      );
    });

    it("marks_permission_request_denied", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(resolvePermissionRequest(transcript, "permission-1", "deny")).toContainEqual(
        expect.objectContaining({ kind: "permission_request", status: "denied" })
      );
    });

    it("clears_pending_permission_actionability_when_turn_is_cancelled", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(markPendingPermissionRequestsUnavailable(transcript)).toContainEqual(
        expect.objectContaining({ kind: "permission_request", status: "unavailable" })
      );
    });
  });
});
