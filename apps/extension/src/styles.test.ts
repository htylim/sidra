import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const ruleSelectors = Array.from(stylesheet.matchAll(/(?<selector>[^{}]+)\{[^{}]*\}/g), (match) =>
  (match.groups?.selector ?? "").trim()
);

function expectRule(selector: string, declarations: string[]) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rulePattern = new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]+)\\}`, "m");
  const match = stylesheet.match(rulePattern);

  expect(match?.groups?.body, `Missing selector: ${selector}`).toBeDefined();
  const body = match?.groups?.body ?? "";

  for (const declaration of declarations) {
    expect(body, `Missing declaration "${declaration}" in ${selector}`).toContain(declaration);
  }
}

describe("extension UI interaction state CSS", () => {
  it("defines_enabled_button_cursor_hover_focus_visible_and_active_states", () => {
    expectRule("button:not(:disabled)", ["cursor: pointer"]);
    expectRule(".toolbar-button:not(:disabled):hover", ["border-color:", "background:"]);
    expectRule(".quick-action-button:not(:disabled):hover", ["border-color: #075e56", "background: #075e56"]);
    expectRule(".send-button:not(:disabled):hover", ["border-color: #075e56", "background: #075e56"]);
    expectRule(".retry-button:not(:disabled):hover", ["border-color: #075e56", "background: #075e56"]);
    expectRule(".secondary-button:not(:disabled):hover", ["border-color:", "background:"]);
    expectRule(".code-copy-button:not(:disabled):hover", ["border-color:", "background:"]);
    expectRule(".permission-actions button:not(:disabled):hover", ["border-color:", "background:"]);
    expectRule(".permission-actions button:first-child:not(:disabled):hover", [
      "border-color: #075e56",
      "background: #075e56"
    ]);
    expectRule(".code-copy-button[data-status=\"copied\"]:not(:disabled):hover", ["border-color: #7dd3c7"]);
    expectRule(".code-copy-button[data-status=\"failed\"]:not(:disabled):hover", ["border-color: #f8b4a0"]);
    expectRule("button:not(:disabled):focus-visible", ["outline:", "outline-offset:"]);
    expectRule("button:not(:disabled):active", ["box-shadow:"]);
  });

  it("keeps_disabled_controls_visually_inert_without_hover_override", () => {
    expectRule("button:disabled,\ninput:disabled,\nselect:disabled,\ntextarea:disabled", ["cursor: not-allowed", "opacity: 0.58"]);
    expectRule(".options-actions .send-button:disabled", ["background: #e6ece9", "color: #62716d", "opacity: 1"]);
    const unguardedButtonStateSelectors = ruleSelectors.filter((selector) => {
      if (!selector.includes(":hover") && !selector.includes(":active")) return false;
      if (!selector.includes("button")) return false;
      return !selector.includes(":not(:disabled)");
    });

    expect(unguardedButtonStateSelectors).toEqual([]);
  });

  it("defines_focus_visible_states_for_text_inputs_and_textareas", () => {
    expectRule("input:not(:disabled):focus-visible", ["outline:", "outline-offset:", "border-color:"]);
    expectRule("textarea:not(:disabled):focus-visible", ["outline:", "outline-offset:", "border-color:"]);
  });

  it("defines_hover_focus_visible_and_active_states_for_activity_disclosure_summaries", () => {
    expectRule(".activity-disclosure summary:hover", ["color:"]);
    expectRule(".activity-disclosure summary:focus-visible", ["outline:", "outline-offset:"]);
    expectRule(".activity-disclosure summary:active", ["color:"]);
  });

  it("defines_activity_disclosure_reasoning_and_action_styles", () => {
    expectRule(".activity-section", ["display: grid", "gap:"]);
    expectRule(".activity-section-title", ["font-size:", "font-weight:"]);
    expectRule(".activity-action", ["display: grid", "gap:"]);
    expectRule(".activity-detail-value", ["overflow-wrap: anywhere"]);
    expectRule(".activity-command-output", ["white-space: pre-wrap", "overflow-wrap: anywhere"]);
  });

  it("defines_invalid_field_styles_for_options_form_validation", () => {
    const formFieldSelector = ".action-row input,\n.action-row textarea";
    const invalidFieldSelector = "input[aria-invalid=\"true\"],\ntextarea[aria-invalid=\"true\"]";

    expectRule(invalidFieldSelector, ["border-color:", "background:"]);
    expectRule("input[aria-invalid=\"true\"]:not(:disabled):focus-visible,\ntextarea[aria-invalid=\"true\"]:not(:disabled):focus-visible", [
      "border-color: #c2410c"
    ]);
    expect(stylesheet.indexOf(invalidFieldSelector)).toBeGreaterThan(stylesheet.indexOf(formFieldSelector));
  });

  it("styles_inline_send_dom_checkbox_as_secondary_composer_option", () => {
    expectRule(".composer-dom-toggle", [
      "display: inline-flex",
      "gap: 6px",
      "color: #62716d",
      "font-size: 12px"
    ]);
    expectRule(".composer-dom-toggle input", ["width: 14px", "height: 14px", "accent-color: #087c71"]);
  });

  it("does_not_keep_prompt_options_button_styles_after_inline_send_dom_replaces_it", () => {
    expect(stylesheet).not.toContain(".options-button");
    expect(stylesheet).not.toContain(".prompt-options-popover");
    expect(stylesheet).not.toContain(".prompt-option-toggle");
  });

  it("uses_prompt_and_response_font_size_variables_for_transcript_text", () => {
    expectRule(".message.user", ["font-size: var(--sidra-prompt-font-size"]);
    expectRule(".message.assistant", ["font-size: var(--sidra-response-font-size"]);
    expectRule(".transcript", ["gap: calc(max(var(--sidra-prompt-font-size", "var(--sidra-response-font-size"]);
    expectRule(".assistant-markdown", ["font-size: var(--sidra-response-font-size"]);
    expectRule(".assistant-markdown h1,\n.assistant-markdown h2,\n.assistant-markdown h3", [
      "font-size: var(--sidra-response-font-size"
    ]);
  });

  it("uses_response_font_size_variable_for_assistant_markdown_code_text", () => {
    expectRule(".assistant-markdown code", ["font-size: var(--sidra-response-font-size"]);
    expectRule(".code-block code", ["font-size: var(--sidra-response-font-size"]);
  });

  it("defines_transcript_action_rail_visibility_target_size_and_active_states", () => {
    expectRule(".transcript-action-rail", ["display: grid", "gap: 6px", "opacity: 0"]);
    expectRule(".transcript-action-button", ["width: 28px", "height: 28px", "border: 1px solid #d8e1dd"]);
    expectRule(".transcript-action-button .sidra-icon", ["width: 16px", "height: 16px"]);
    expectRule(
      ".transcript-message-row:hover .transcript-action-rail,\n.transcript-message-row:focus-within .transcript-action-rail,\n.transcript-message-row[data-speech-active=\"true\"] .transcript-action-rail,\n.transcript-message-row[data-copy-active=\"true\"] .transcript-action-rail",
      ["opacity: 1", "pointer-events: auto"]
    );
    expectRule(".transcript-action-button:not(:disabled):hover,\n.transcript-action-button:not(:disabled):focus-visible", [
      "background: #eef3f1",
      "color: #52615d"
    ]);
    expectRule(".transcript-action-button[data-speech-state=\"active\"],\n.transcript-action-button[data-copy-state=\"copied\"]", [
      "border-color: #83b8ae",
      "background: #eef8f5",
      "color: #075e56"
    ]);
  });

  it("keeps_non_prompt_transcript_ui_at_fixed_supporting_font_size", () => {
    expectRule(".status-card", ["font-size: 13px"]);
    expectRule(".permission-card", ["font-size: 13px"]);
    expectRule(".waiting-indicator", ["font-size: 13px"]);
    expectRule(".activity-disclosure summary", ["font-size: 13px"]);
    expectRule(".activity-section-title", ["font-size: 13px"]);
    expectRule(".activity-reasoning", ["font-size: 13px"]);
    expectRule(".activity-action", ["font-size: 13px"]);
    expectRule(".activity-command-output code", ["font-size: 13px"]);
    expectRule(".permission-card h3", ["font-size: 13px"]);
    expectRule(".permission-scope", ["font-size: 13px"]);
    expectRule(".permission-command", ["font-size: 13px"]);
  });

  it("styles_waiting_indicator_as_inline_assistant_progress", () => {
    expectRule(".waiting-indicator", [
      "display: inline-flex",
      "align-items: baseline",
      "gap: 4px",
      "width: fit-content",
      "max-width: min(88%, 100%)",
      "font-size: 13px"
    ]);
    expectRule(".waiting-dots", [
      "display: inline-flex",
      "align-items: flex-end",
      "gap: 3px",
      "width: 20px",
      "height: 0.9em",
      "flex: 0 0 auto",
      "transform: translateY(1px)"
    ]);
  });

  it("keeps_waiting_indicator_unboxed_on_the_transcript_background", () => {
    expectRule(".waiting-indicator", ["display: inline-flex", "color: #62716d"]);

    const waitingIndicatorRule = stylesheet.match(/\.waiting-indicator\s*{(?<body>[^}]+)}/m);
    const body = waitingIndicatorRule?.groups?.body ?? "";
    expect(body).not.toContain("border:");
    expect(body).not.toContain("background:");
    expect(body).not.toContain("padding:");
  });

  it("defines_waiting_dot_animation_and_reduced_motion_fallback", () => {
    expect(stylesheet).toContain("@keyframes sidra-waiting-dot");
    expectRule(".waiting-dot", ["animation: sidra-waiting-dot 1.2s ease-in-out infinite"]);
    expectRule(".waiting-dot:nth-child(2)", ["animation-delay: 0.15s"]);
    expectRule(".waiting-dot:nth-child(3)", ["animation-delay: 0.3s"]);
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesheet).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*{\s*\.waiting-dot\s*{[^}]*animation:\s*none;[^}]*transform:\s*none;/m);
  });

  it("keeps_waiting_indicator_supporting_text_at_fixed_font_size", () => {
    expectRule(".waiting-indicator", ["font-size: 13px"]);
  });
});
