# Sidra Learning Guide

Use this guide to learn the codebase by following one real product path:

```text
User types prompt
-> React side panel
-> extension controller
-> Chrome Native Messaging connection
-> shared protocol validation
-> local bridge
-> provider session manager
-> mock assistant response
-> React side panel renders transcript
```

This is not a TypeScript or React tutorial. It is a tour of this codebase using TypeScript, React, and Chrome extension ideas as they appear in real code.

## 1. Mental Model

Sidra has three main code owners:

- `apps/extension`: browser extension UI and browser-side application state.
- `packages/protocol`: typed message contract between extension and bridge.
- `apps/bridge`: local Node process that receives extension commands and talks to an agent provider.

The important architecture rule is:

```text
React renders state and sends user intent.
Protocol defines message shape.
Bridge owns provider sessions.
```

Do not expect the React component to know how Native Messaging works. Do not expect the bridge to know about React. That separation is the point of the codebase.

## 2. First Reading Path

Read these files in this order.

### A. Product And Ownership

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ENGINEERING-GUIDELINES.md`

Goal: understand what Sidra is, what is implemented, and which module owns each behavior.

Key idea:

```text
When you wonder "where should this code go?", answer by ownership, not convenience.
```

### B. React Entry Point

Read:

- `apps/extension/src/side-panel.tsx`
- `apps/extension/src/side-panel-view.tsx`

What to notice:

- `side-panel.tsx` creates one controller.
- `useSyncExternalStore` subscribes React to non-React state.
- `SidePanelView` receives data and callbacks as props.
- The view owns local draft text because it is pure UI input state.
- The view does not own session startup, bridge readiness, or protocol messages.

Beginner TypeScript ideas:

- `SidePanelSnapshot` is a named shape for UI state.
- Callback prop types describe what the view can ask the app to do.

Beginner React ideas:

- `useState` is used for local UI state.
- `useSyncExternalStore` is used when state lives outside React.
- The view is easier to test because it is mostly props in, JSX out.

### C. Extension Application Boundary

Read:

- `apps/extension/src/side-panel-controller.ts`
- `apps/extension/src/bridge/session-coordinator.ts`
- `apps/extension/src/transcript.ts`

What to notice:

- `SidePanelController` is the public interface used by React.
- `BridgeSessionCoordinator` owns session startup, pending prompts, and incoming bridge messages.
- `transcript.ts` contains small pure functions for transcript updates.

Important flow:

```text
sendPrompt(prompt)
-> if no provider session exists, send session.start
-> store prompt as pending
-> when session.started arrives, send session.send
-> when assistant.text.delta arrives, append assistant text
```

Beginner TypeScript ideas:

- `type SidePanelController = { ... }` describes a module interface.
- `BridgeSessionCoordinatorSnapshot` models readable state instead of exposing class internals.
- Union message types from `@sidra/protocol` make switch statements safer.

Beginner architecture idea:

```text
The controller hides sequencing from React.
React should not need to know that "session.start" must happen before "session.send".
```

### D. Chrome Native Messaging Boundary

Read:

- `apps/extension/src/bridge/connection.ts`
- `apps/extension/public/manifest.json`
- `apps/extension/public/background.js`

What to notice:

- `BridgeConnection` wraps `chrome.runtime.connectNative`.
- The wrapper exposes `post`, `retry`, `disconnect`, and subscriptions.
- Raw incoming messages are parsed before other code sees them.
- The manifest grants the extension capabilities.

Beginner Chrome extension ideas:

- A Manifest V3 extension declares permissions in `manifest.json`.
- `connectNative` opens a port to a local installed host.
- Native Messaging is not a normal HTTP request. It is a browser-managed connection to a local process.

### E. Shared Protocol

Read:

- `packages/protocol/src/index.ts`
- `packages/protocol/src/protocol.test.ts`

What to notice:

- `ExtensionToBridge` is every command the extension may send.
- `BridgeToExtension` is every message the bridge may send back.
- Runtime parsing protects the Native Messaging boundary.
- TypeScript types help during development, but runtime validation still matters because external messages are `unknown`.

Important beginner distinction:

```text
TypeScript checks your source code.
Runtime parsers check real data.
Native Messaging receives real data.
```

### F. Local Bridge

Read:

- `apps/bridge/src/native-messaging.ts`
- `apps/bridge/src/index.ts`
- `apps/bridge/src/session-manager.ts`

What to notice:

- `native-messaging.ts` reads and writes Chrome Native Messaging frames.
- `index.ts` validates protocol messages and dispatches commands.
- `session-manager.ts` owns provider sessions, in-flight turns, cancel, reset, and close.
- The current provider is a mock provider that returns `Mock response to: <prompt>`.

Beginner Node idea:

```text
The bridge is a local process using stdin/stdout.
Chrome sends length-prefixed JSON messages to it.
```

## 3. Message Flow Walkthrough

Start with this user action:

```text
Type "Summarize this page" and press Capture + Send.
```

Then trace the code:

1. `SidePanelView.sendPrompt` trims the draft and calls `onSendPrompt`.
2. `SidePanelController.sendPrompt` delegates to `BridgeSessionCoordinator`.
3. `BridgeSessionCoordinator.sendPrompt` sends `session.start` if needed.
4. `BridgeConnection.post` opens the Native Messaging port and posts the message.
5. `packages/protocol.parseExtensionToBridge` validates the message in the bridge.
6. `createBridge.handleValidatedMessage` dispatches `session.start`.
7. `BridgeSessionManager.startSession` creates a provider session.
8. The bridge emits `session.started`.
9. The extension receives `session.started` and flushes pending prompts as `session.send`.
10. The mock provider yields `assistant.text.delta` and `assistant.done`.
11. The extension receives `assistant.text.delta`.
12. `addAssistantTextDelta` updates the transcript.
13. React re-renders from the latest snapshot.

## 4. Exercises

Do these in order. Each one teaches one boundary.

### Exercise 1: Change The Empty State Text

Files:

- `apps/extension/src/side-panel-view.tsx`

Goal:

- Change a visible label.
- Run tests.

Learn:

- Basic JSX.
- React component props and local state.

### Exercise 2: Add A Transcript Role Test

Files:

- `apps/extension/src/transcript.ts`
- `apps/extension/src/transcript.test.ts`

Goal:

- Add or modify a pure transcript behavior.

Learn:

- Simple TypeScript types.
- Pure function testing.

### Exercise 3: Add A New Protocol Error Code

Files:

- `packages/protocol/src/index.ts`
- `packages/protocol/src/protocol.test.ts`

Goal:

- Add a typed message variant or tighten validation.

Learn:

- Union types.
- Runtime validation.
- Why protocol changes start in `packages/protocol`.

### Exercise 4: Teach The Mock Provider A New Response

Files:

- `apps/bridge/src/index.ts`
- `apps/bridge/src/bridge.smoke.test.ts`

Goal:

- Change mock provider behavior and update tests.

Learn:

- Async generators.
- Bridge-owned provider behavior.
- End-to-end message flow without real Codex.

### Exercise 5: Add One Controller-Level Behavior

Files:

- `apps/extension/src/side-panel-controller.ts`
- `apps/extension/src/side-panel-controller.test.ts`

Goal:

- Add behavior through the controller interface, not directly in React.

Learn:

- Application boundary design.
- Testing behavior through a public interface.

## 5. Commands To Use While Learning

```sh
pnpm test
pnpm check
pnpm build
pnpm test:e2e
```

Use focused tests while studying a file:

```sh
pnpm --filter @sidra/extension test
pnpm --filter @sidra/protocol test
pnpm --filter @sidra/bridge test
```

## 6. Glossary

`Side panel`

The browser extension UI shown beside the current page.

`Controller`

The extension application boundary used by React. It exposes commands and snapshots.

`Snapshot`

A plain object representing current readable state for a subscriber.

`Native Messaging`

Chrome extension mechanism for talking to a local executable through stdin/stdout.

`Protocol`

The versioned message contract between extension and bridge.

`Provider`

The agent implementation used by the bridge. The current code uses a mock provider.

`Session`

A conversation lifecycle. The extension has a client session ID. The bridge maps that to provider state.

`In-flight turn`

A prompt currently being processed by a provider session.

## 7. Best Learning Artifacts For This Repo

These are the useful artifacts to create next.

1. Codebase map

   A one-page diagram showing owners and message direction. Good first artifact because it prevents wrong mental models.

2. Guided walkthrough

   A step-by-step trace of one prompt from UI to mock response. This guide now includes the first version.

3. Exercise ladder

   A sequence of tiny changes from UI text to protocol changes to bridge behavior. Best for learning by editing.

4. Annotated source notes

   Short comments beside selected files explaining why each boundary exists. Useful only after you have read the files once.

5. Debugging playbook

   A checklist for “prompt did not get a response”, starting at UI state and ending at Native Messaging host setup.

6. Concept cards

   Small notes for TypeScript unions, React external stores, Chrome manifests, Native Messaging frames, async generators, and AbortController.

## 8. Suggested Learning Plan

Week 1:

- Read the first reading path.
- Run all tests.
- Do exercises 1 and 2.

Week 2:

- Trace the full message flow with tests open.
- Do exercises 3 and 4.

Week 3:

- Study `BridgeSessionCoordinator` and `BridgeSessionManager`.
- Do exercise 5.
- Write your own short explanation of where a new feature should go.

The real milestone is this:

```text
You can explain why a feature belongs in React, the extension controller, the protocol package, or the bridge.
```
