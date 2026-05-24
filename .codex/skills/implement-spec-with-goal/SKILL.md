---
name: implement-spec-with-goal
description: Implement a given spec phase by phase with a goal-driven workflow, using repeated pr-review loops until no important findings remain.
---

# Implement Spec With Goal

Use this skill when the user wants to implement a given spec with review-driven hardening.

## Process

1. Establish the goal: implement the given spec until no important review findings remain.
2. Study this project first. Read the durable project docs and relevant code before editing.
3. Study the spec named by the user.
4. Use the `specs` skill to implement the spec.
5. Implement one spec phase at a time.
6. Do not run manual verification after each phase unless the user explicitly asked for it or the phase cannot be validated any other way.
7. After each phase, use the `pr-review` skill on only the changes from that phase.
8. Apply fixes for important review findings.
9. Repeat the pr-review and fix loop for that phase until there are no important review findings left.
10. Move to the next phase and repeat the same phase implementation and review loop.
11. After all phases are implemented, use the `pr-review` skill again on the full set of changes.
12. Apply fixes for important whole-change findings.
13. Repeat the whole-change pr-review and fix loop until there are no important review findings left.

## Constraints

- Respect Sidra ownership boundaries from docs/ARCHITECTURE.md.
- Keep specs frozen except for checking off completed phase checkboxes.
- Run relevant automated tests or checks when practical, especially for changed ownership boundaries.
- Keep the final report concise. Include changed files, tests/checks run, the final review result, and a report of the amount of loops tackled.
