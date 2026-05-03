# Alwats Follow
- Add concise docstrings/comments only where behavior, ownership, or async invariants are non-obvious.
- Agent must make sure proper design decisions are always taken.
- Code must be easily understood, easy to maintain, and follow best practices.
- Prefer explicit architecture over quick local patches.
- If a user request would require a broad refactor or complete overhaul to avoid a brittle hack, say that plainly and let the user decide before implementing.
- Side panel UI should stay presentational. It must not accumulate bridge protocol sequencing, provider lifecycle, URL session management, cancellation, permission, or heartbeat logic.
- Bridge transport, URL-scoped session state, capture state, and provider lifecycle should live behind clear non-React interfaces that can be tested without browser UI.
- Add or update tests at the same boundary where behavior belongs. Avoid tests that pass only because they bypass the real interaction being changed.


# Gotchas
- Keep project clean. Do not extend temporary patterns when the next change needs a better boundary
