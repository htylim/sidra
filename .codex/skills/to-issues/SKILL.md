---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable local issue files using tracer-bullet vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, or break down work into issues.
---

# To Issues

Break a plan into independently-grabbable local issue files using vertical slices (tracer bullets).

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an existing local issue number or path, read it from `docs/issues/`.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Create the local issue files

For each approved slice, create one Markdown file in `docs/issues/`. Use the issue body template below.

Create files in dependency order (blockers first) so you can reference real issue numbers in the "Blocked by" field.

Use sequential filenames:

- `docs/issues/issue-001.md`
- `docs/issues/issue-002.md`
- `docs/issues/issue-003.md`

If `docs/issues/` already contains issue files, continue from the highest existing number. Do not overwrite existing issue files.

<issue-template>
## Status

Open

## Parent

#<parent-issue-number> (if the source was an existing local issue, otherwise omit this section)

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by #<issue-number> (if any)

Or "None - can start immediately" if no blockers.

</issue-template>

Use the `## Status` section to track state. Valid statuses are `Open`, `Closed`, `Wont Do`, and `Partial`. For `Partial`, add a short note below the status explaining what shipped and what remains.

Do NOT close or modify any parent issue.
