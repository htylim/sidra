import { memo } from "react";
import type { PermissionDecision } from "@sidra/protocol";
import { AssistantMarkdown } from "./assistant-markdown";
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

export function TranscriptView(props: {
  entries: TranscriptEntry[];
  onRespondToPermission(requestId: string, decision: PermissionDecision): void;
}) {
  return (
    <div className="transcript">
      {props.entries.map((entry, index) => (
        <MemoizedTranscriptEntryView
          entry={entry}
          key={entry.id ?? `${entry.kind}-${index}`}
          onRespondToPermission={props.onRespondToPermission}
        />
      ))}
    </div>
  );
}

function TranscriptEntryView(props: {
  entry: TranscriptEntry;
  onRespondToPermission(requestId: string, decision: PermissionDecision): void;
}) {
  if (props.entry.kind === "user_message") return <UserMessage entry={props.entry} />;
  if (props.entry.kind === "assistant_turn") return <AssistantTurn entry={props.entry} />;
  if (props.entry.kind === "permission_request") {
    return <PermissionRequestCard entry={props.entry} onRespondToPermission={props.onRespondToPermission} />;
  }
  return <StatusCard entry={props.entry} />;
}

const MemoizedTranscriptEntryView = memo(TranscriptEntryView);

function UserMessage(props: { entry: UserMessageEntry }) {
  return <div className="message user">{props.entry.text}</div>;
}

function AssistantTurn(props: { entry: AssistantTurnEntry }) {
  return (
    <article className={`message assistant assistant-turn ${props.entry.status}`}>
      {props.entry.markdown.trim() ? <AssistantMarkdown markdown={props.entry.markdown} /> : null}
      {props.entry.status === "streaming" ? <div className="turn-status">Streaming</div> : null}
      {hasVisibleActivity(props.entry.activity) ? <ActivityDisclosure activity={props.entry.activity} /> : null}
    </article>
  );
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
            <h3 className="activity-section-title">Actions</h3>
            <div className="activity-action-list">
              {props.activity.tools.map((tool) => (
                <ToolActivity key={tool.itemId} tool={tool} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}

function ToolActivity(props: { tool: ToolActivityEntry }) {
  return (
    <div className="activity-action">
      <div className="activity-action-header">
        <span className="activity-action-title">{props.tool.title}</span>
        <span className={`activity-action-phase ${props.tool.phase}`}>{activityPhaseLabel(props.tool.phase)}</span>
      </div>
      {props.tool.details.length > 0 ? (
        <dl className="activity-detail-list">
          {props.tool.details.map((detail, index) => (
            <div className="activity-detail" key={`${props.tool.itemId}-${detail.label}-${index}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {props.tool.commandOutput.length > 0 ? (
        <div className="activity-command-output-list">
          {props.tool.commandOutput.map((output, index) => (
            <pre className="activity-command-output" key={`${props.tool.itemId}-${output.stream}-${index}`}>
              <code>{output.text}</code>
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function activityPhaseLabel(phase: ToolActivityEntry["phase"]): string {
  return phase === "completed" ? "Completed" : "Started";
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
      <div className="permission-card-header">
        <span className="permission-card-label">{permissionStatusLabel(props.entry.status)}</span>
        {props.entry.metadata?.toolName ? <span className="permission-tool">{props.entry.metadata.toolName}</span> : null}
      </div>
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

function permissionStatusLabel(status: PermissionRequestEntry["status"]): string {
  switch (status) {
    case "pending":
      return "Permission requested";
    case "allowed_once":
      return "Allowed once";
    case "allowed_for_session":
      return "Allowed for this session";
    case "denied":
      return "Denied";
    case "unavailable":
      return "Unavailable";
  }
}
