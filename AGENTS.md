- Read [architecture-decisions.md](docs/architecture-decisions.md)

# Agent Instructions

- Keep this project clean. Do not extend temporary patterns when the next change needs a better boundary.
- Prefer explicit architecture over quick local patches when behavior crosses UI, bridge transport, provider sessions, or protocol state.
- If a user request would require a broad refactor or complete overhaul to avoid a brittle hack, say that plainly and let the user decide before implementing.
- Side panel UI should stay mostly presentational. It must not accumulate bridge protocol sequencing, provider lifecycle, URL session management, cancellation, permission, or heartbeat logic.
- Bridge transport, URL-scoped session state, capture state, and provider lifecycle should live behind clear non-React interfaces that can be tested without browser UI.
- Add or update tests at the same boundary where behavior belongs. Avoid tests that pass only because they bypass the real interaction being changed.
