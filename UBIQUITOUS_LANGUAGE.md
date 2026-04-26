# Ubiquitous Language

## Product and surfaces

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Sidra** | The Chromium side panel extension that lets a user chat with a local AI agent about the current page. | Browser agent, sidebar assistant, extension app |
| **Side Panel** | The Chromium browser panel where Sidra displays page identity, chat, controls, and status. | Sidebar, drawer, chat window |
| **Settings Page** | The dedicated extension options page where persistent Sidra configuration is edited. | Settings modal, preferences panel |
| **Current Page Card** | The persistent side-panel card showing the active page identity and context state for the visible URL session. | Context card, page card, page context card |
| **Prompt Composer** | The bottom input area where the user writes a prompt and chooses the send mode. | Input box, message box, chat input |
| **Prompt Options Popover** | The compact composer popover for per-prompt options such as **Send Full DOM**. | Context menu, options menu, settings popover |
| **Quick Action** | A configured shortcut prompt shown in an empty URL session. | Suggested prompt, canned prompt, shortcut |

## Sessions and chat lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **URL Session** | An in-memory chat session scoped to a normalized page identity while the side panel is alive. | Chat session, page session, conversation |
| **Page Key** | The normalized URL identity used by the extension to map a browser page to a URL session. | Session key, normalized URL, canonical URL |
| **Client Session ID** | The extension-owned opaque identifier used to address a URL session in bridge protocol messages. | Session ID, browser session ID |
| **Bridge Session ID** | The bridge-owned opaque identifier returned after starting a session. | Native session ID, bridge ID |
| **Provider Session** | The provider-owned agent thread/session mapped one-to-one to a URL session until reset or close. | Codex thread, agent session, provider thread |
| **Transcript** | The visible sequence of user prompts, assistant responses, context markers, errors, and permission cards for a URL session. | Chat history, conversation log |
| **Draft Prompt** | The unsent prompt text saved independently for each URL session. | Draft, input draft |
| **In-flight Prompt** | A prompt currently being handled by the provider for one URL session. | Running request, active prompt |
| **Assistant Turn** | One provider response cycle for a user prompt, including streamed text, activity, permission requests, errors, or cancellation. | Agent response, assistant message |
| **New Chat** | The action that resets only the currently visible URL session and starts a fresh provider session for the same page key. | Reset chat, clear conversation |
| **Side Panel Shutdown** | The end of the side panel lifetime, clearing extension memory and closing bridge sessions. | Panel close, app shutdown |

## Capture and context

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Capture** | The explicit user-triggered act of reading the active tab and building page context. | Scrape, ingest, background capture |
| **Capture + Send** | The send mode that captures the active page at click time and sends it with the user prompt. | Send with context, attach page |
| **Send** | The send mode that sends only the user prompt unless context is already part of the provider session. | Plain send, chat only |
| **Page Context** | The structured page data attached to a prompt for provider use. | Context, attachment, page payload |
| **Readable Content** | Article-like page text extracted by Readability or a text fallback. | Article text, extracted text, readable text |
| **Full DOM** | The complete DOM capture mode used instead of readable content when **Send Full DOM** is enabled. | DOM context, raw DOM, page HTML |
| **Metadata** | Non-content page facts such as URL, canonical URL, title, site name, excerpt, byline, language, text length, and capture timestamp. | Page info, page details |
| **Metadata-only Context** | Page context containing metadata without readable content or full DOM. | Metadata attached, partial context |
| **Capture Mode** | The mutually exclusive choice between readable content and full DOM for a capture request. | Context mode, extraction mode |
| **Context State** | The session-specific status shown in the current page card for what page context has been attached or skipped. | Attachment state, page status |
| **Context Marker** | An inline transcript status card that summarizes what context was attached or skipped. | Attachment marker, status card |
| **Content Size Limit** | A configurable maximum for readable content or full DOM payloads. | Context limit, payload limit |
| **Hard Safety Ceiling** | A bridge-enforced maximum payload size independent of extension settings. | Hard limit, bridge limit |
| **Untrusted Reference Material** | Captured page content presented to the provider as data, not instructions. | Untrusted content, reference context |

## Bridge and provider

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Native Messaging Bridge** | The local Node/TypeScript process that connects the extension to an agent provider through Chromium Native Messaging. | Bridge, local bridge, native host |
| **Native Messaging Host** | The installed browser-facing host entry named `com.sidra.agent_bridge`. | Host manifest target, native app |
| **Bridge Protocol** | The versioned JSON message contract exchanged between the extension and the Native Messaging bridge. | Protocol, native protocol |
| **Provider** | A bridge-side implementation that creates and runs agent sessions. | AI backend, model backend, agent backend |
| **Codex Provider** | The V1 provider implementation that talks to Codex through `codex-sdk`. | Codex backend, Codex adapter |
| **Agent Event** | A streamed provider event that may represent answer text, activity, errors, cancellation, or other visible progress. | Stream event, provider event |
| **Activity** | Safe provider progress information shown collapsed under an activity section. | Tool activity, progress log |
| **Heartbeat** | A periodic extension message used by the bridge to detect dead side-panel connections. | Ping, keepalive |
| **Provider Allowlist** | The bridge restriction that only approved provider IDs can be started. | Backend allowlist, provider whitelist |

## Permissions and errors

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Permission Request** | A provider-originated request for user approval to use a tool or perform an action. | Tool request, approval prompt |
| **Permission Decision** | The user's answer to a permission request: allow once, allow for this session, or deny. | Approval choice, permission response |
| **Session-scoped Approval** | A permission approval that applies only to the current URL session/thread. | Temporary approval, session permission |
| **Operational Error** | A user-visible failure state from capture, bridge connection, provider setup, streaming, or cancellation. | Error, failure |
| **Blocking Setup Error** | A bridge-unavailable state that disables prompting until the connection is fixed or retried. | Setup panel, connection blocker |
| **Cancellation** | The user action or provider result that stops an in-flight prompt while preserving partial output. | Cancel, abort |

## Installation and privacy

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Manual Developer Installation** | The V1 installation flow for building Sidra, installing Native Messaging manifests, and loading the unpacked extension. | Installer, dev setup |
| **Host Manifest** | The browser-specific Native Messaging manifest that allowlists the Sidra extension ID. | Native manifest, browser manifest |
| **Pinned Extension ID** | The stable extension identifier required so host manifests can allowlist Sidra reliably. | Fixed extension ID, extension key |
| **Bridge Log** | Local bridge diagnostics that may include events, timings, IDs, provider IDs, and errors but not prompts or page content by default. | Log, telemetry |
| **Content Logging** | Explicit opt-in logging of prompts or captured page content if ever added. | Prompt logging, payload logging |

## Relationships

- A **Side Panel** owns zero or more live **URL Sessions** while it is active.
- A **URL Session** belongs to exactly one **Page Key**.
- A **URL Session** has one **Transcript**, one **Draft Prompt**, one **Context State**, and one **Provider Session**.
- A **Page Key** is derived from a canonical URL when available, otherwise from the current URL without hash and without common tracking parameters.
- A **Client Session ID** identifies one **URL Session** in the **Bridge Protocol**.
- A **Provider Session** is created by exactly one **Provider** and reused until **New Chat**, session close, or **Side Panel Shutdown**.
- **New Chat** resets exactly one visible **URL Session** and does not affect other URL sessions.
- **Capture + Send** creates **Page Context** and sends it with a prompt.
- **Send** sends a prompt without performing a new **Capture**.
- **Page Context** contains **Metadata** and either **Readable Content**, **Full DOM**, or neither when only **Metadata-only Context** is available.
- **Readable Content** and **Full DOM** are mutually exclusive **Capture Modes**.
- A **Context Marker** belongs to a **Transcript** and summarizes the page context sent or skipped for a turn.
- A **Permission Request** belongs to a specific **URL Session** and **Assistant Turn**.
- A **Session-scoped Approval** is cleared by **New Chat**, reset, close, or **Side Panel Shutdown**.
- A **Heartbeat** belongs to the active native connection and allows the **Native Messaging Bridge** to clean up abandoned sessions.
- A **Host Manifest** allowlists one **Pinned Extension ID** for one browser.

## Example dialogue

> **Dev:** "When the user clicks **Capture + Send**, do we update every open conversation for that article?"
> **Domain expert:** "No. The extension recomputes the **Page Key**, finds that **URL Session**, creates **Page Context**, and adds a **Context Marker** only to that session's **Transcript**."
>
> **Dev:** "If **Send Full DOM** is enabled, should we include **Readable Content** too?"
> **Domain expert:** "No. **Full DOM** and **Readable Content** are mutually exclusive **Capture Modes**. The **Page Context** still includes **Metadata**."
>
> **Dev:** "What happens when the readable text exceeds the **Content Size Limit**?"
> **Domain expert:** "Sidra sends **Metadata-only Context**, shows a **Context Marker** explaining that content was too large, and does not silently truncate."
>
> **Dev:** "Does **New Chat** clear approvals for every tab?"
> **Domain expert:** "No. **New Chat** clears the visible **URL Session**, including its **Session-scoped Approvals**, and leaves other URL sessions untouched."

## Flagged ambiguities

- "session" is overloaded across browser state, bridge state, and provider state. Use **URL Session**, **Bridge Session ID**, and **Provider Session** explicitly.
- "context" can mean the current page card state, the payload sent to the provider, or a transcript marker. Use **Context State**, **Page Context**, and **Context Marker**.
- "chat session" should be avoided because it hides URL scoping. Use **URL Session** unless discussing generic UI copy.
- "page" can mean the active browser tab, the normalized identity, or captured data. Use **active tab**, **Page Key**, or **Page Context** as appropriate.
- "DOM" should not be used interchangeably with readable text or HTML snippets. Use **Full DOM** only for the optional capture mode.
- "bridge" and "host" are distinct. Use **Native Messaging Bridge** for the local process and **Native Messaging Host** or **Host Manifest** for browser installation concepts.
- "permission" can mean extension browser permissions or provider tool approvals. Use **Extension Permission** in implementation docs and **Permission Request** or **Session-scoped Approval** for provider approvals.
- "history" should not be used for V1 persistence. Use **Transcript** for the visible in-memory conversation because V1 has no persistent chat history.
