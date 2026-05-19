---
name: implement-spec-with-goal
description: Use cmux to launch Codex CLI with a goal-driven workflow that implements a given spec phase by phase, using repeated pr-review loops until no important findings remain.
---

# Implement Spec With Goal

Use this skill when the user wants a Codex CLI session, launched through cmux, to implement a given spec with review-driven hardening.

## Process

1. Use the `cmux` skill to open a dedicated cmux surface for this task.
2. In that surface, launch `codex` CLI from the project root.
3. Send Codex the prompt below, replacing `<SPEC>` with the spec path or spec identifier given by the user.
4. Monitor the cmux surface until the Codex session reaches a stable waiting state or completes.

## Codex Prompt

```text
/goal Implement spec until no more important review findings.

Spec to implement: <SPEC>

Process:
1. Study this project first. Read the durable project docs and relevant code before editing.
2. Study the spec named above.
3. Use the specs skill to implement the spec.
4. Implement one spec phase at a time.
5. Do not run manual verification after each phase unless the user explicitly asked for it or the phase cannot be validated any other way.
6. After each phase, use the pr-review skill on only the changes from that phase.
7. Apply fixes for important review findings.
8. Repeat the pr-review and fix loop for that phase until there are no important review findings left.
9. Move to the next phase and repeat the same phase implementation and review loop.
10. After all phases are implemented, use the pr-review skill again on the full set of changes.
11. Apply fixes for important whole-change findings.
12. Repeat the whole-change pr-review and fix loop until there are no important review findings left.

Constraints:
- Respect Sidra ownership boundaries from docs/ARCHITECTURE.md.
- Keep specs frozen except for checking off completed phase checkboxes.
- Run relevant automated tests or checks when practical, especially for changed ownership boundaries.
- Keep the final report concise. Include changed files, tests/checks run, the final review result, and a report of the amount of loops tackled.
```
