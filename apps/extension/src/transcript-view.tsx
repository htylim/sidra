import { memo } from "react";
import { AssistantMarkdown } from "./assistant-markdown";
import type {
  AssistantTurnEntry,
  SafeActivityEntry,
  StatusEntry,
  TranscriptEntry,
  UserMessageEntry
} from "./transcript";

export function TranscriptView(props: { entries: TranscriptEntry[] }) {
  return (
    <div className="transcript">
      {props.entries.map((entry, index) => (
        <MemoizedTranscriptEntryView entry={entry} key={entry.id ?? `${entry.kind}-${index}`} />
      ))}
    </div>
  );
}

function TranscriptEntryView(props: { entry: TranscriptEntry }) {
  if (props.entry.kind === "user_message") return <UserMessage entry={props.entry} />;
  if (props.entry.kind === "assistant_turn") return <AssistantTurn entry={props.entry} />;
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
      {props.entry.activity.length > 0 ? <ActivityDisclosure activity={props.entry.activity} /> : null}
    </article>
  );
}

function ActivityDisclosure(props: { activity: SafeActivityEntry[] }) {
  return (
    <details className="activity-disclosure">
      <summary>Activity</summary>
      <ul>
        {props.activity.map((activity, index) => (
          <li key={`${activity.kind}-${activity.label}-${index}`}>
            <span className="activity-kind">{activity.kind}</span>
            <span>{activity.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function StatusCard(props: { entry: StatusEntry }) {
  const role = props.entry.tone === "error" ? "alert" : "status";
  return (
    <div className={`status-card ${props.entry.tone}`} role={role}>
      {props.entry.text}
    </div>
  );
}
