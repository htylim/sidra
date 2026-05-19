---
name: create-spec-with-goal
description: Use cmux to launch Codex CLI with a goal-driven workflow that writes a spec for a specified issue, then iterates adversarial spec review until no important findings remain.
---

# Create Spec With Goal

Use this skill when the user wants a Codex CLI session, launched through cmux, to write a spec for a specific issue and harden it through adversarial review.

## Process

1. Use the `cmux` skill to open a dedicated cmux surface for this task.
2. In that surface, launch `codex` CLI from the project root.
3. Send Codex the prompt below, replacing `<ISSUE>` with the issue path, issue number, or issue description given by the user.
4. Monitor the cmux surface until the Codex session reaches a stable waiting state or completes.

## Codex Prompt

```text
/goal Write spec file for given issue.

Issue to spec: <ISSUE>

Process:
1. Study this project first. Read the durable project docs and relevant code before planning.
2. Study the issue files in docs/issues to understand how the project is being implemented. Treat them as planning context, not durable source of truth.
3. Focus on the specific issue named above.
4. Use the specs skill to create a spec for the issue.
5. When the spec file is done, launch a read-only subagent with high reasoning effort to perform an adversarial review of the spec.
6. Apply fixes for important review findings.
7. Repeat the adversarial review and fix loop until there are no important review findings left.

Constraints:
- Keep the spec grounded in the current codebase.
- Respect Sidra ownership boundaries from docs/ARCHITECTURE.md.
- Do not implement the spec.
- Keep the final report concise. Include the spec path, the final review result and a report of the amount of loops tackled.
```
