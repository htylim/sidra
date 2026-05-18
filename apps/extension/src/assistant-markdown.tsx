import type { ReactNode } from "react";
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
  async function copyCode() {
    await navigator.clipboard?.writeText(props.code);
  }

  return (
    <div className="code-block">
      <button type="button" className="code-copy-button" onClick={copyCode}>
        Copy code
      </button>
      <pre>{props.children}</pre>
    </div>
  );
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
