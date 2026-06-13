import { memo, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PermissionDecision } from "@sidra/protocol";
import { AssistantMarkdown } from "./assistant-markdown";
import { SidraIcon } from "./sidra-icon";
import type { TranscriptSpeechSnapshot } from "./transcript-speech-controller";
import type {
  AssistantTurnEntry,
  PermissionRequestEntry,
  StatusEntry,
  ToolActivityEntry,
  TranscriptActivity,
  TranscriptEntry,
  UserMessageEntry
} from "./transcript";
import { hasVisibleActivity } from "./transcript";

export type TranscriptWaitingState =
  | { kind: "idle" }
  | { kind: "waiting_for_response"; label: "Waiting" }
  | { kind: "cancelling"; label: "Cancelling" };

export type TranscriptClipboardGateway = {
  writeText(text: string): Promise<void>;
};

type TranscriptCopyStatus = "idle" | "copied" | "failed";

type TranscriptActionDescriptor = {
  entryId: string;
  text: string;
  speechEnabled: boolean;
};

const COPY_FEEDBACK_MS = 1500;

const browserTranscriptClipboardGateway: TranscriptClipboardGateway = {
  async writeText(text) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is unavailable.");
    }
    await navigator.clipboard.writeText(text);
  }
};

export function TranscriptView(props: {
  entries: TranscriptEntry[];
  promptFontSizePx: number;
  responseFontSizePx: number;
  waitingState: TranscriptWaitingState;
  speech: TranscriptSpeechSnapshot;
  onRespondToPermission(requestId: string, decision: PermissionDecision): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): void;
  clipboard?: TranscriptClipboardGateway;
}) {
  const clipboard = props.clipboard ?? browserTranscriptClipboardGateway;
  const mountedRef = useRef(true);
  const latestCopyAttemptByEntryRef = useRef<Record<string, number>>({});
  const copyResetTimerByEntryRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [copyStatuses, setCopyStatuses] = useState<Record<string, TranscriptCopyStatus>>({});
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const transcriptStyle = {
    "--sidra-prompt-font-size": `${props.promptFontSizePx}px`,
    "--sidra-response-font-size": `${props.responseFontSizePx}px`
  } as CSSProperties;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      for (const timerId of Object.values(copyResetTimerByEntryRef.current)) {
        clearTimeout(timerId);
      }
      copyResetTimerByEntryRef.current = {};
    };
  }, []);

  async function copyTranscriptText(entryId: string, text: string) {
    const copyAttempt = (latestCopyAttemptByEntryRef.current[entryId] ?? 0) + 1;
    latestCopyAttemptByEntryRef.current[entryId] = copyAttempt;
    clearCopyResetTimer(entryId);

    try {
      await clipboard.writeText(text);
      if (!copyAttemptIsCurrent(entryId, copyAttempt)) return;
      setCopyStatus(entryId, "copied");
      setCopyAnnouncement("Copied message text.");
    } catch {
      if (!copyAttemptIsCurrent(entryId, copyAttempt)) return;
      setCopyStatus(entryId, "failed");
      setCopyAnnouncement("Could not copy message text.");
    }

    copyResetTimerByEntryRef.current[entryId] = setTimeout(() => {
      if (!mountedRef.current) return;
      setCopyStatus(entryId, "idle");
    }, COPY_FEEDBACK_MS);
  }

  function copyAttemptIsCurrent(entryId: string, copyAttempt: number): boolean {
    return mountedRef.current && latestCopyAttemptByEntryRef.current[entryId] === copyAttempt;
  }

  function setCopyStatus(entryId: string, status: TranscriptCopyStatus) {
    setCopyStatuses((current) => {
      const next = { ...current };
      if (status === "idle") {
        delete next[entryId];
      } else {
        next[entryId] = status;
      }
      return next;
    });
  }

  function clearCopyResetTimer(entryId: string) {
    const timerId = copyResetTimerByEntryRef.current[entryId];
    if (!timerId) return;
    clearTimeout(timerId);
    delete copyResetTimerByEntryRef.current[entryId];
  }

  return (
    <div className="transcript" style={transcriptStyle}>
      {props.entries.map((entry, index) => (
        <MemoizedTranscriptEntryView
          entry={entry}
          key={entry.id ?? `${entry.kind}-${index}`}
          speech={props.speech}
          copyStatusByEntryId={copyStatuses}
          onRespondToPermission={props.onRespondToPermission}
          onCopyTranscriptText={(entryId, text) => void copyTranscriptText(entryId, text)}
          onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
        />
      ))}
      <WaitingIndicator waitingState={props.waitingState} />
      <div className="transcript-action-live-region visually-hidden" aria-live="polite">
        {copyAnnouncement}
      </div>
    </div>
  );
}

function WaitingIndicator(props: { waitingState: TranscriptWaitingState }) {
  if (props.waitingState.kind === "idle") return null;

  return (
    <div
      className={`waiting-indicator ${props.waitingState.kind}`}
      role="status"
      aria-live="polite"
      aria-label={props.waitingState.label}
    >
      <span>{props.waitingState.label}</span>
      <span className="waiting-dots" aria-hidden="true">
        <span className="waiting-dot" />
        <span className="waiting-dot" />
        <span className="waiting-dot" />
      </span>
    </div>
  );
}

function TranscriptEntryView(props: {
  entry: TranscriptEntry;
  speech: TranscriptSpeechSnapshot;
  copyStatusByEntryId: Record<string, TranscriptCopyStatus>;
  onRespondToPermission(requestId: string, decision: PermissionDecision): void;
  onCopyTranscriptText(entryId: string, text: string): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): void;
}) {
  if (props.entry.kind === "user_message") {
    return (
      <UserMessage
        entry={props.entry}
        speech={props.speech}
        copyStatusByEntryId={props.copyStatusByEntryId}
        onCopyTranscriptText={props.onCopyTranscriptText}
        onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
      />
    );
  }
  if (props.entry.kind === "assistant_turn") {
    return (
      <AssistantTurn
        entry={props.entry}
        speech={props.speech}
        copyStatusByEntryId={props.copyStatusByEntryId}
        onCopyTranscriptText={props.onCopyTranscriptText}
        onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
      />
    );
  }
  if (props.entry.kind === "permission_request") {
    return <PermissionRequestCard entry={props.entry} onRespondToPermission={props.onRespondToPermission} />;
  }
  return <StatusCard entry={props.entry} />;
}

const MemoizedTranscriptEntryView = memo(TranscriptEntryView);

function UserMessage(props: {
  entry: UserMessageEntry;
  speech: TranscriptSpeechSnapshot;
  copyStatusByEntryId: Record<string, TranscriptCopyStatus>;
  onCopyTranscriptText(entryId: string, text: string): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): void;
}) {
  if (props.entry.display?.kind === "quick_action") {
    return <QuickActionUserMessage entry={props.entry} />;
  }

  const action = actionForUserMessage(props.entry);
  const message = <div className="message user">{props.entry.text}</div>;
  if (!action) return message;

  return (
    <TranscriptMessageFrame
      align="user"
      action={action}
      speech={props.speech}
      copyStatus={props.copyStatusByEntryId[action.entryId] ?? "idle"}
      onCopyTranscriptText={props.onCopyTranscriptText}
      onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
    >
      {message}
    </TranscriptMessageFrame>
  );
}

function QuickActionUserMessage(props: { entry: UserMessageEntry }) {
  const [expanded, setExpanded] = useState(false);
  const promptTextId = useId();

  return (
    <div className="message user quick-action-user-message">
      <button
        type="button"
        className="quick-action-user-label"
        aria-expanded={expanded}
        aria-controls={promptTextId}
        onClick={() => setExpanded((current) => !current)}
      >
        <SidraIcon name="sparkle" className="quick-action-user-icon" />
        <span>{props.entry.display?.kind === "quick_action" ? props.entry.display.label : props.entry.text}</span>
        <SidraIcon
          name="chevron-down"
          className={`quick-action-disclosure-icon${expanded ? " expanded" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="quick-action-prompt-text" id={promptTextId}>
          {props.entry.text}
        </div>
      ) : null}
    </div>
  );
}

function AssistantTurn(props: {
  entry: AssistantTurnEntry;
  speech: TranscriptSpeechSnapshot;
  copyStatusByEntryId: Record<string, TranscriptCopyStatus>;
  onCopyTranscriptText(entryId: string, text: string): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): void;
}) {
  const hasActivity = hasVisibleActivity(props.entry.activity);
  const hasResponseBody = props.entry.markdown.trim().length > 0;
  const action = hasResponseBody ? actionForAssistantTurn(props.entry) : undefined;
  const response = (
    <article className="message assistant assistant-response">
      <AssistantMarkdown markdown={props.entry.markdown} />
    </article>
  );

  return (
    <div className={`assistant-turn ${props.entry.status}`}>
      {hasActivity ? <ActivityDisclosure activity={props.entry.activity} /> : null}
      {hasResponseBody && action ? (
        <TranscriptMessageFrame
          align="assistant"
          action={action}
          speech={props.speech}
          copyStatus={props.copyStatusByEntryId[action.entryId] ?? "idle"}
          onCopyTranscriptText={props.onCopyTranscriptText}
          onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
        >
          {response}
        </TranscriptMessageFrame>
      ) : hasResponseBody ? (
        response
      ) : null}
    </div>
  );
}

function TranscriptMessageFrame(props: {
  align: "assistant" | "user";
  action: TranscriptActionDescriptor;
  speech: TranscriptSpeechSnapshot;
  copyStatus: TranscriptCopyStatus;
  children: ReactNode;
  onCopyTranscriptText(entryId: string, text: string): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): void;
}) {
  const speechIsActive =
    props.speech.activeEntryId === props.action.entryId &&
    (props.speech.status === "loading" || props.speech.status === "playing" || props.speech.status === "paused");
  const copyIsActive = props.copyStatus === "copied" || props.copyStatus === "failed";

  return (
    <div
      className={`transcript-message-row ${props.align}-message-row`}
      data-speech-active={speechIsActive ? "true" : undefined}
      data-copy-active={copyIsActive ? "true" : undefined}
    >
      {props.children}
      <TranscriptBubbleActions
        action={props.action}
        speech={props.speech}
        speechIsActive={speechIsActive}
        copyStatus={props.copyStatus}
        onCopyTranscriptText={props.onCopyTranscriptText}
        onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
      />
      {props.speech.status === "error" && props.speech.activeEntryId === props.action.entryId && props.speech.error ? (
        <div className="transcript-action-error">{props.speech.error}</div>
      ) : null}
    </div>
  );
}

function TranscriptBubbleActions(props: {
  action: TranscriptActionDescriptor;
  speech: TranscriptSpeechSnapshot;
  speechIsActive: boolean;
  copyStatus: TranscriptCopyStatus;
  onCopyTranscriptText(entryId: string, text: string): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): void;
}) {
  const speechDisabled = !props.action.speechEnabled || !props.speech.enabled;
  const speechButtonLabel = labelForSpeechButton(props.speech, props.speechIsActive);
  const speechIcon = iconForSpeechButton(props.speech, props.speechIsActive);
  const copyButtonLabel = labelForCopyButton(props.copyStatus);

  return (
    <div className="transcript-action-rail" aria-live="off">
      <button
        type="button"
        className="transcript-action-button"
        aria-busy={props.speechIsActive && props.speech.status === "loading" ? "true" : undefined}
        aria-label={speechButtonLabel}
        title={speechButtonLabel}
        data-speech-state={props.speechIsActive ? "active" : "idle"}
        disabled={speechDisabled}
        onClick={() => props.onToggleSpeechForTranscriptEntry(props.action.entryId, props.action.text)}
      >
        <SidraIcon name={speechIcon} className="transcript-action-icon" />
      </button>
      <button
        type="button"
        className="transcript-action-button"
        aria-label={copyButtonLabel}
        title={copyButtonLabel}
        data-copy-state={props.copyStatus}
        onClick={() => props.onCopyTranscriptText(props.action.entryId, props.action.text)}
      >
        <SidraIcon name="copy" className="transcript-action-icon" />
      </button>
    </div>
  );
}

function actionForUserMessage(entry: UserMessageEntry): TranscriptActionDescriptor | undefined {
  if (entry.display?.kind === "quick_action") return undefined;
  const text = normalizeVisibleMessageText(entry.text);
  if (!text) return undefined;
  return {
    entryId: entry.id ?? fallbackTranscriptActionId("user", text),
    text,
    speechEnabled: true
  };
}

function actionForAssistantTurn(entry: AssistantTurnEntry): TranscriptActionDescriptor | undefined {
  const text = normalizeVisibleMessageText(entry.text || entry.markdown);
  if (!text) return undefined;
  return {
    entryId: entry.id ?? fallbackTranscriptActionId("assistant", `${entry.status}:${text}`),
    text,
    speechEnabled: entry.status !== "streaming"
  };
}

function labelForSpeechButton(speech: TranscriptSpeechSnapshot, speechIsActive: boolean): string {
  if (!speechIsActive) return "Read message aloud";
  return speech.status === "paused" ? "Resume message audio" : "Pause message audio";
}

function iconForSpeechButton(speech: TranscriptSpeechSnapshot, speechIsActive: boolean): "play" | "pause" {
  if (!speechIsActive) return "play";
  return speech.status === "paused" ? "play" : "pause";
}

function labelForCopyButton(copyStatus: TranscriptCopyStatus): string {
  if (copyStatus === "copied") return "Copied message text";
  if (copyStatus === "failed") return "Copy failed";
  return "Copy message text";
}

function normalizeVisibleMessageText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function fallbackTranscriptActionId(prefix: "assistant" | "user", text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}-${text.length}`;
}

function ActivityDisclosure(props: { activity: TranscriptActivity }) {
  return (
    <details className="activity-disclosure">
      <summary>Activity</summary>
      <div className="activity-content">
        {props.activity.reasoningSummary.trim() ? (
          <section className="activity-section">
            <h3 className="activity-section-title">Reasoning</h3>
            <p className="activity-reasoning">{props.activity.reasoningSummary}</p>
          </section>
        ) : null}
        {props.activity.tools.length > 0 ? (
          <section className="activity-section">
            <div className="activity-action-list">
              {groupToolActivities(props.activity.tools).map((group) => (
                <ToolActivityGroup key={group.key} group={group} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}

type ToolActivityGroupEntry = {
  key: string;
  title: string;
  tools: ToolActivityEntry[];
};

function ToolActivityGroup(props: { group: ToolActivityGroupEntry }) {
  const detailValues = props.group.tools.flatMap((tool) => tool.details.map((detail) => detail.value));
  const commandOutput = props.group.tools.flatMap((tool) => tool.commandOutput);

  return (
    <div className="activity-action">
      <div className="activity-action-title">{props.group.title}</div>
      {detailValues.length > 0 ? (
        <div className="activity-detail-list">
          {detailValues.map((value, index) => (
            <div className="activity-detail-value" key={`${props.group.key}-detail-${index}`}>
              {value}
            </div>
          ))}
        </div>
      ) : null}
      {commandOutput.length > 0 ? (
        <div className="activity-command-output-list">
          {commandOutput.map((output, index) => (
            <pre className="activity-command-output" key={`${props.group.key}-${output.stream}-${index}`}>
              <code>{output.text}</code>
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function groupToolActivities(tools: ToolActivityEntry[]): ToolActivityGroupEntry[] {
  const groups: ToolActivityGroupEntry[] = [];

  for (const tool of tools) {
    const key = `${tool.toolKind}:${tool.title}`;
    const existingGroup = groups.find((group) => group.key === key);
    if (existingGroup) {
      existingGroup.tools.push(tool);
      existingGroup.title = toolGroupTitle(tool, existingGroup.tools.length);
      continue;
    }

    groups.push({ key, title: toolGroupTitle(tool, 1), tools: [tool] });
  }

  return groups;
}

function toolGroupTitle(tool: ToolActivityEntry, count: number): string {
  const title = tool.toolKind === "web_search" ? "Searched web" : tool.title;
  return count === 1 ? title : `${title} ${count} times`;
}

function StatusCard(props: { entry: StatusEntry }) {
  const role = props.entry.tone === "error" ? "alert" : "status";
  return (
    <div className={`status-card ${props.entry.tone}`} role={role}>
      {props.entry.text}
    </div>
  );
}

function PermissionRequestCard(props: {
  entry: PermissionRequestEntry;
  onRespondToPermission(requestId: string, decision: PermissionDecision): void;
}) {
  const pending = props.entry.status === "pending";
  const titleId = `permission-title-${props.entry.requestId}`;
  const descriptionId = `permission-description-${props.entry.requestId}`;
  return (
    <section
      className={`permission-card ${props.entry.status}`}
      role={pending ? "status" : undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <h3 id={titleId}>{props.entry.title}</h3>
      <div className="permission-copy" id={descriptionId}>
        <div className="permission-scope">Scope: {props.entry.permissionKey}</div>
        {props.entry.description ? <p>{props.entry.description}</p> : null}
      </div>
      {props.entry.metadata?.commandPreview ? (
        <pre className="permission-command">
          <code>{props.entry.metadata.commandPreview}</code>
        </pre>
      ) : null}
      {pending ? (
        <div className="permission-actions">
          <button
            type="button"
            aria-label={`Allow once for ${props.entry.permissionKey}`}
            onClick={() => props.onRespondToPermission(props.entry.requestId, "allow_once")}
          >
            Allow once
          </button>
          <button
            type="button"
            aria-label={`Allow for this session for ${props.entry.permissionKey}`}
            onClick={() => props.onRespondToPermission(props.entry.requestId, "allow_for_session")}
          >
            Allow for this session
          </button>
          <button
            type="button"
            aria-label={`Deny ${props.entry.permissionKey}`}
            onClick={() => props.onRespondToPermission(props.entry.requestId, "deny")}
          >
            Deny
          </button>
        </div>
      ) : null}
    </section>
  );
}
