# Engineering Guidelines

Use these rules when implementing, reviewing, or planning changes. They are intentionally general: the same standards should hold for any serious codebase.

## Core Standard

- Build the proper solution for the current problem, not the fastest local patch.
- Start from first principles: identify the behavior, the owner of that behavior, the public interface, the state lifecycle, and the failure modes before editing code.
- Prefer simple systems, not simplistic code. A design is simple when each part has one clear reason to exist and one clear reason to change.
- Use deep modules: expose a small, stable interface that hides meaningful complexity behind it.
- Avoid shallow modules that only forward calls, rename data, or spread one behavior across many places without hiding complexity.
- Separate responsibilities by ownership, not by convenience. Distinct concerns such as presentation, transport, data contracts, persistence, domain state, orchestration, policy, and external integrations should not collapse into one object because it is easy in the moment.
- Model state so invalid combinations are difficult to express. Prefer explicit state variants, typed outcomes, and named lifecycle transitions over loose flags, nullable fields, or implicit conventions that can drift out of sync.
- Avoid having multiple parts of the system each believe they own the same truth. Duplicate derived views are okay. Duplicate ownership is the problem.

## Before Implementing

- Read the relevant architecture docs, product docs, tests, and existing code before deciding where the change belongs.
- Identify the public interface first. Ask: what should callers be able to do without knowing the implementation details?
- Identify the owning module. If no module clearly owns the behavior, create or refactor toward the right boundary before adding the feature.
- Identify the test boundary. Tests should exercise behavior through the public interface that owns the behavior.
- Check whether the requested change extends a temporary pattern. If it does, refactor the boundary first or discuss the tradeoff with the user.
- If the correct solution is larger than the requested change, do not silently implement a shortcut. Explain the cost and ask how to proceed.

## Module Design

- A module should have a clear responsibility, a narrow interface, and hidden internals.
- A good module absorbs complexity so callers stay simple.
- A module boundary is wrong if every caller must understand its internal sequencing, state machine, retries, or error mapping.
- Prefer composition over large multipurpose objects. Compose small owners with explicit interfaces.
- Keep orchestration separate from low-level IO. Transport adapters should not own domain state. Presentation should not own workflow sequencing. Storage should not own business rules.
- Keep policy separate from mechanism. A low-level mechanism can connect, parse, persist, or emit; a policy decides when and why.
- Avoid global singletons except at composition roots. Dependency creation belongs at the edge; behavior should be testable with injected dependencies.
- Do not expose implementation-shaped snapshots just because they are convenient for a view. Views should receive derived state in product/application terms.

## Testing Rules

- Add or update tests at the same boundary where the behavior belongs.
- Prefer behavior tests through public interfaces over tests that assert private method calls or internal structure.
- Use focused integration-style tests when multiple real modules must cooperate.
- Use mocks and fakes at external boundaries: browser APIs, network, filesystem, external SDKs, clocks, and process IO.
- Do not mock internal collaborators to prove implementation details. That makes refactors unsafe.
- Every bug fix should first have a failing test that proves the bug.
- Every architectural refactor should keep behavior tests green and may add targeted boundary tests when the boundary itself is important.
- Avoid tests that pass only because they bypass the real interaction being changed.

## Temporary Code

- Temporary code must be easy to delete, clearly contained, and not used as a foundation for later features.
- Do not extend a temporary pattern when the next change needs a better boundary.
- Compatibility wrappers are acceptable during refactor, but they must remain thin and be removed after callers move.
- Do not normalize hacks by adding tests around the hack's shape. Test the desired behavior and refactor toward the right design.

## When To Stop And Discuss

Stop and discuss with the user instead of implementing when:

- The proper solution requires a broader refactor than the user requested.
- The clean design conflicts with an existing architecture decision.
- The only obvious implementation would put behavior in the wrong owner.
- The change would create a temporary path likely to become permanent.
- The requested behavior is ambiguous at the product or domain level.
- The cost, risk, or migration impact is materially higher than expected.

When stopping, be specific:

- State the proper solution.
- State why the quick approach is harmful.
- State the smallest safe alternative.
- Ask for a decision on scope.

## Documentation

- Keep docs current when code ownership, module boundaries, or product behavior changes.
- Prefer concise current-state docs over long history logs.
- Document non-obvious ownership, lifecycle, async ordering, and failure-handling rules.
- Add concise comments only where behavior, ownership, or async invariants are non-obvious.
