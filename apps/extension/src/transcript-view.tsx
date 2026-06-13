import { memo, useId, useState, type CSSProperties } from "react";
import type { PermissionDecision } from "@sidra/protocol";
import { AssistantMarkdown } from "./assistant-markdown";
import { SidraIcon } from "./sidra-icon";
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
  promptFontSizePx: number;
  responseFontSizePx: number;
  onRespondToPermission(requestId: string, decision: PermissionDecision): void;
}) {
  const transcriptStyle = {
    "--sidra-prompt-font-size": `${props.promptFontSizePx}px`,
    "--sidra-response-font-size": `${props.responseFontSizePx}px`
  } as CSSProperties;

  return (
    <div className="transcript" style={transcriptStyle}>
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
  if (props.entry.display?.kind === "quick_action") {
    return <QuickActionUserMessage entry={props.entry} />;
  }
  return <div className="message user">{props.entry.text}</div>;
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

function AssistantTurn(props: { entry: AssistantTurnEntry }) {
  const hasActivity = hasVisibleActivity(props.entry.activity);
  const hasResponseBody = props.entry.markdown.trim() || props.entry.status === "streaming";

  return (
    <div className={`assistant-turn ${props.entry.status}`}>
      {hasActivity ? <ActivityDisclosure activity={props.entry.activity} /> : null}
      {hasResponseBody ? (
        <article className="message assistant assistant-response">
          {props.entry.markdown.trim() ? <AssistantMarkdown markdown={props.entry.markdown} /> : null}
          {props.entry.status === "streaming" ? <div className="turn-status">Streaming</div> : null}
        </article>
      ) : null}
    </div>
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
