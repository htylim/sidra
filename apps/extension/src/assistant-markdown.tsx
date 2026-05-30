import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function AssistantMarkdown(props: { markdown: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ children, href }) => <SafeMarkdownLink href={href}>{children}</SafeMarkdownLink>,
          img: () => null,
          pre: ({ children }) => <CodeBlock code={extractText(children)}>{children}</CodeBlock>,
          code: ({ children, className }) => <code className={className}>{children}</code>
        }}
      >
        {props.markdown}
      </ReactMarkdown>
    </div>
  );
}

function SafeMarkdownLink(props: { href?: string; children: ReactNode }) {
  if (!isSafeAbsoluteUrl(props.href)) {
    return <span>{props.children}</span>;
  }

  return (
    <a href={props.href} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  );
}

function CodeBlock(props: { code: string; children: ReactNode }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<number | undefined>(undefined);
  const latestCopyAttemptRef = useRef(0);

  useEffect(() => {
    return () => {
      latestCopyAttemptRef.current += 1;
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  async function copyCode() {
    const copyAttempt = latestCopyAttemptRef.current + 1;
    latestCopyAttemptRef.current = copyAttempt;
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    setCopyStatus("idle");

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(props.code);
      if (latestCopyAttemptRef.current !== copyAttempt) return;
      setCopyStatus("copied");
    } catch {
      if (latestCopyAttemptRef.current !== copyAttempt) return;
      setCopyStatus("failed");
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      resetTimerRef.current = undefined;
    }, 1500);
  }

  return (
    <div className="code-block">
      <button type="button" className="code-copy-button" data-status={copyStatus} onClick={() => void copyCode()}>
        {copyStatusLabel(copyStatus)}
      </button>
      <pre>{props.children}</pre>
    </div>
  );
}

function copyStatusLabel(copyStatus: "idle" | "copied" | "failed"): string {
  if (copyStatus === "copied") return "Copied";
  if (copyStatus === "failed") return "Copy failed";
  return "Copy code";
}

function isSafeAbsoluteUrl(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return "";
}
