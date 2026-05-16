- Read [ENGINEERING-GUIDELINES.md](docs/ENGINEERING-GUIDELINES.md)
- Read [ARCHITECTURE.md](docs/ARCHITECTURE.md). Treat it as the source of truth for Sidra-specific ownership boundaries.
- Read [NATIVE-MESSAGING-MANUAL-E2E.md](docs/NATIVE-MESSAGING-MANUAL-E2E.md) before manual extension E2E testing with the local bridge.
- Keep docs current when code ownership or product behavior changes.
- Prefer concise current-state docs over long history logs.
- Treat `docs/issues` and `docs/specs` as planning work product, not durable reference docs. They may contain historical plans, completed checklists, or implementation notes, and they do not need to stay current after the work is done.
- Write docs, comments, issue text, and user-facing copy in simple, clear sentences. Favor concise language; do not treat more words as more readable.

## Learning-Oriented Code

- Treat this codebase as a teaching codebase. Code should be easy for a TypeScript, React, and Chrome extension learner to read without lowering engineering standards.
- Prefer explicit, readable names over terse names. A good name should reveal the domain concept, lifecycle role, or browser API responsibility it represents.
- Keep functions small enough to explain one idea, but do not split code into shallow wrappers that hide no complexity.
- Prefer straightforward control flow over clever expressions, dense chaining, or implicit side effects.
- Use TypeScript as documentation. Model important states, commands, results, and errors with named types instead of loose objects, booleans, or `any`.
- Make React components read as views. Keep rendering, user intent handlers, derived display state, and side effects visually distinct.
- Make Chrome extension boundaries obvious. Browser APIs, permissions, runtime messages, Native Messaging, storage, and tab/page capture should sit behind named boundaries instead of appearing as incidental calls throughout UI code.
- Document the reason for non-obvious decisions close to the code. Comments should explain ownership, lifecycle, async ordering, browser constraints, or type modeling choices that a learner could otherwise misread.
- Do not comment every line or restate what the syntax already says. Noise makes the important comments harder to find.
- When adding a new pattern, leave a small, idiomatic example that future code can copy safely.
