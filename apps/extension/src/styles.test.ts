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
    expectRule(".options-button:not(:disabled):hover", ["border-color:", "background:"]);
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
    expectRule(".options-button[data-state=\"open\"]:not(:disabled):hover", ["background: #dff3ee"]);
    expectRule(".code-copy-button[data-status=\"copied\"]:not(:disabled):hover", ["border-color: #7dd3c7"]);
    expectRule(".code-copy-button[data-status=\"failed\"]:not(:disabled):hover", ["border-color: #f8b4a0"]);
    expectRule("button:not(:disabled):focus-visible", ["outline:", "outline-offset:"]);
    expectRule("button:not(:disabled):active", ["box-shadow:"]);
  });

  it("keeps_disabled_controls_visually_inert_without_hover_override", () => {
    expectRule("button:disabled,\ninput:disabled,\ntextarea:disabled", ["cursor: not-allowed", "opacity: 0.58"]);
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

  it("defines_invalid_field_styles_for_options_form_validation", () => {
    const formFieldSelector = ".action-row input,\n.action-row textarea";
    const invalidFieldSelector = "input[aria-invalid=\"true\"],\ntextarea[aria-invalid=\"true\"]";

    expectRule(invalidFieldSelector, ["border-color:", "background:"]);
    expectRule("input[aria-invalid=\"true\"]:not(:disabled):focus-visible,\ntextarea[aria-invalid=\"true\"]:not(:disabled):focus-visible", [
      "border-color: #c2410c"
    ]);
    expect(stylesheet.indexOf(invalidFieldSelector)).toBeGreaterThan(stylesheet.indexOf(formFieldSelector));
  });
});
