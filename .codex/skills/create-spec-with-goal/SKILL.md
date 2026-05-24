---
name: create-spec-with-goal
description: Write a spec for a specified issue with a goal-driven workflow, then iterate adversarial spec review until no important findings remain.
---

# Create Spec With Goal

Use this skill when the user wants to write a spec for a specific issue and harden it through adversarial review.

## Process

1. Establish the goal: write a spec file for the given issue.
2. Study this project first. Read the durable project docs and relevant code before planning.
3. Study the issue files in `docs/issues` to understand how the project is being implemented. Treat them as planning context, not durable source of truth.
4. Focus on the specific issue named by the user.
5. Use the `specs` skill to create a spec for the issue.
6. When the spec file is done, run a read-only adversarial review of the spec with high reasoning effort.
7. Apply fixes for important review findings.
8. Repeat the adversarial review and fix loop until there are no important review findings left.

## Constraints

- Keep the spec grounded in the current codebase.
- Respect Sidra ownership boundaries from docs/ARCHITECTURE.md.
- Do not implement the spec.
- Keep the final report concise. Include the spec path, the final review result and a report of the amount of loops tackled.
