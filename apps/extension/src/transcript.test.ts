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
  hasVisibleActivity,
  markPendingPermissionRequestsUnavailable,
  removeTranscriptEntriesByIds,
  resolvePermissionRequest,
  type SafeActivityEntry,
  type TranscriptEntry
} from "./transcript";

function commandToolActivity(phase: "started" | "completed"): SafeActivityEntry {
  return {
    kind: "tool",
    itemId: "command-1",
    toolKind: "command",
    phase,
    title: "Run command",
    details: [{ label: "Command", value: "pnpm test" }]
  };
}

describe("transcript reducer", () => {
  describe("rich transcript reducer", () => {
    it("adds_user_prompt_entries_as_user_message_variants", () => {
      expect(addUserPrompt([], "  <script>alert(1)</script>  ")).toEqual([
        { kind: "user_message", role: "user", text: "<script>alert(1)</script>" }
      ]);
    });

    it("preserves_internal_user_prompt_line_breaks", () => {
      expect(addUserPrompt([], "  First line\n\n- Second line\nThird line  ")).toEqual([
        { kind: "user_message", role: "user", text: "First line\n\n- Second line\nThird line" }
      ]);
    });

    it("adds_quick_action_user_prompt_entries_with_label_display_metadata", () => {
      expect(addUserPrompt([], " Full prompt ", undefined, { kind: "quick_action", label: " Summarize " })).toEqual([
        {
          kind: "user_message",
          role: "user",
          text: "Full prompt",
          display: { kind: "quick_action", label: "Summarize" }
        }
      ]);
    });

    it("keeps_plain_user_prompt_entries_without_quick_action_metadata", () => {
      expect(addUserPrompt([], "Plain prompt")).toEqual([
        { kind: "user_message", role: "user", text: "Plain prompt" }
      ]);
    });

    it("trims_quick_action_label_and_prompt_before_storage_in_transcript", () => {
      expect(addUserPrompt([], " Prompt body ", undefined, { kind: "quick_action", label: " Label " })).toEqual([
        {
          kind: "user_message",
          role: "user",
          text: "Prompt body",
          display: { kind: "quick_action", label: "Label" }
        }
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
          activity: { reasoningSummary: "", tools: [] },
          status: "streaming"
        }
      ]);
    });

    it("assigns_stable_distinct_ids_to_duplicate_assistant_turns", () => {
      const firstTurn = completeAssistantTurn(addAssistantTextDelta([], "Same reply"));
      const secondTurn = completeAssistantTurn(addAssistantTextDelta(addUserPrompt(firstTurn, "next"), "Same reply"));
      const assistantTurns = secondTurn.filter((entry): entry is Extract<TranscriptEntry, { kind: "assistant_turn" }> => {
        return entry.kind === "assistant_turn";
      });

      expect(assistantTurns).toHaveLength(2);
      expect(assistantTurns[0].id).toBeDefined();
      expect(assistantTurns[1].id).toBeDefined();
      expect(assistantTurns[0].id).not.toBe(assistantTurns[1].id);
      expect(assistantTurns[0].status).toBe("complete");
      expect(assistantTurns[1].status).toBe("complete");
    });

    it("starts_a_new_assistant_turn_after_a_user_message", () => {
      const transcript = addAssistantTextDelta(addUserPrompt(addAssistantTextDelta([], "Previous"), "next"), "New");

      expect(transcript).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Previous",
          text: "Previous",
          activity: { reasoningSummary: "", tools: [] },
          status: "streaming"
        },
        { kind: "user_message", role: "user", text: "next" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "New",
          text: "New",
          activity: { reasoningSummary: "", tools: [] },
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
          activity: { reasoningSummary: "", tools: [] },
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
          activity: { reasoningSummary: "", tools: [] },
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
          activity: { reasoningSummary: "", tools: [] },
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
      const activity: SafeActivityEntry = { kind: "reasoning_summary_delta", text: "Working" };
      const completeTurn = completeAssistantTurn(addAssistantTextDelta([], "Done"));

      expect(addAssistantTextDelta(completeTurn, "Next")).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Done",
          text: "Done",
          activity: { reasoningSummary: "", tools: [] },
          status: "complete"
        },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Next",
          text: "Next",
          activity: { reasoningSummary: "", tools: [] },
          status: "streaming"
        }
      ]);
      expect(addAssistantActivity(completeTurn, activity).at(-1)).toEqual({
        kind: "assistant_turn",
        role: "assistant",
        markdown: "",
        text: "",
        activity: { reasoningSummary: "Working", tools: [] },
        status: "streaming"
      });
    });

    it("adds_safe_activity_to_the_current_assistant_turn", () => {
      const activity: SafeActivityEntry = { kind: "reasoning_summary_delta", text: "Reading" };

      expect(addAssistantActivity(addAssistantTextDelta([], "Working"), activity)).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Working",
          text: "Working",
          activity: { reasoningSummary: "Reading", tools: [] },
          status: "streaming"
        }
      ]);
    });

    it("adds_reasoning_summary_delta_to_the_current_assistant_turn", () => {
      const transcript = addAssistantActivity(addAssistantTextDelta([], "Working"), {
        kind: "reasoning_summary_delta",
        text: "Checked the nearby code."
      });

      expect(transcript.at(-1)).toMatchObject({
        kind: "assistant_turn",
        activity: { reasoningSummary: "Checked the nearby code.", tools: [] }
      });
    });

    it("appends_multiple_reasoning_summary_deltas_in_order", () => {
      const transcript = addAssistantActivity(
        addAssistantActivity([], { kind: "reasoning_summary_delta", text: "Read tests. " }),
        { kind: "reasoning_summary_delta", text: "Updated reducer." }
      );

      expect(transcript.at(-1)).toMatchObject({
        activity: { reasoningSummary: "Read tests. Updated reducer.", tools: [] }
      });
    });

    it("adds_tool_activity_to_the_current_assistant_turn", () => {
      const transcript = addAssistantActivity([], commandToolActivity("started"));

      expect(transcript.at(-1)).toMatchObject({
        kind: "assistant_turn",
        activity: {
          reasoningSummary: "",
          tools: [{ itemId: "command-1", toolKind: "command", phase: "started", title: "Run command", commandOutput: [] }]
        }
      });
    });

    it("updates_existing_tool_activity_by_item_id_when_completed", () => {
      const transcript = addAssistantActivity(addAssistantActivity([], commandToolActivity("started")), commandToolActivity("completed"));

      expect(transcript.at(-1)).toMatchObject({
        activity: {
          tools: [{ itemId: "command-1", phase: "completed", title: "Run command" }]
        }
      });
    });

    it("attaches_command_output_to_the_matching_tool_activity", () => {
      const transcript = addAssistantActivity(addAssistantActivity([], commandToolActivity("started")), {
        kind: "command_output_delta",
        itemId: "command-1",
        stream: "stdout",
        text: "PASS"
      });

      expect(transcript.at(-1)).toMatchObject({
        activity: {
          tools: [{ itemId: "command-1", commandOutput: [{ stream: "stdout", text: "PASS" }] }]
        }
      });
    });

    it("does_not_create_visible_activity_for_generic_progress_only", () => {
      const transcript = addAssistantTextDelta([], "Answer only");
      const turn = transcript.at(-1);

      expect(turn?.kind === "assistant_turn" ? hasVisibleActivity(turn.activity) : true).toBe(false);
    });

    it("starts_new_streaming_turns_when_real_activity_arrives_after_terminal_turns", () => {
      const completeTurn = completeAssistantTurn(addAssistantTextDelta([], "Done"));

      expect(addAssistantActivity(completeTurn, { kind: "reasoning_summary_delta", text: "New work" }).at(-1)).toMatchObject({
        kind: "assistant_turn",
        activity: { reasoningSummary: "New work", tools: [] },
        status: "streaming"
      });
    });

    it("updates_streaming_assistant_turns_when_status_entries_follow_them", () => {
      const transcript = addStatusEntry(addAssistantTextDelta([], "Partial"), "Bridge is slow");

      expect(completeAssistantTurn(addAssistantTextDelta(transcript, " output"))).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Partial output",
          text: "Partial output",
          activity: { reasoningSummary: "", tools: [] },
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
          activity: { reasoningSummary: "", tools: [] },
          status: "complete"
        },
        { kind: "status", role: "status", tone: "neutral", text: "Session started" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Next",
          text: "Next",
          activity: { reasoningSummary: "", tools: [] },
          status: "streaming"
        }
      ]);
    });

    it("creates_an_assistant_turn_for_activity_before_text", () => {
      const activity = commandToolActivity("started");

      expect(addAssistantActivity([], activity)).toEqual([
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "",
          text: "",
          activity: { reasoningSummary: "", tools: [{ ...activity, commandOutput: [] }] },
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
          activity: { reasoningSummary: "", tools: [] },
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

    it("keeps_post_permission_output_after_removing_permission_card", () => {
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
        itemId: "command-1",
        toolKind: "command",
        phase: "started",
        title: "Run command",
        details: [{ label: "Command", value: "pnpm test" }]
      });

      expect(transcript).toEqual([
        { kind: "user_message", role: "user", text: "run it" },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Checking",
          text: "Checking",
          activity: { reasoningSummary: "", tools: [] },
          status: "complete"
        },
        {
          kind: "assistant_turn",
          role: "assistant",
          markdown: "Allowed",
          text: "Allowed",
          activity: {
            reasoningSummary: "",
            tools: [
              {
                kind: "tool",
                itemId: "command-1",
                toolKind: "command",
                phase: "started",
                title: "Run command",
                details: [{ label: "Command", value: "pnpm test" }],
                commandOutput: []
              }
            ]
          },
          status: "streaming"
        }
      ]);
    });

    it("removes_permission_request_after_allow_once", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(resolvePermissionRequest(transcript, "permission-1", "allow_once")).not.toContainEqual(
        expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
      );
    });

    it("removes_permission_request_after_allow_for_session", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(resolvePermissionRequest(transcript, "permission-1", "allow_for_session")).not.toContainEqual(
        expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
      );
    });

    it("removes_permission_request_after_deny", () => {
      const transcript = addPermissionRequest([], {
        requestId: "permission-1",
        permissionKey: "shell:ls",
        title: "Run command"
      });

      expect(resolvePermissionRequest(transcript, "permission-1", "deny")).not.toContainEqual(
        expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
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
