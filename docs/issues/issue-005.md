# Enforce Context Size Limits

## Status

Complete

## Type

AFK

## What to build

Add settings-backed readable content size limits so Sidra never silently truncates captured page text and clearly marks metadata-only sends when content is too large.

## Acceptance criteria

- [x] Extension settings define a readable content size limit with a V1 default.
- [x] If readable content exceeds the configured limit, Sidra sends metadata only and does not send partial readable text.
- [x] Current page card and transcript marker show `Content too large` or equivalent metadata-only state.
- [x] Bridge enforces a hard payload safety ceiling and surfaces oversized payload errors separately from extension-side size handling.
- [x] Tests cover under-limit sends, over-limit metadata-only sends, storage default loading, live setting changes, and bridge hard-limit rejection.

## Completed after

- #004
