"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, FileCode, ExternalLink } from "lucide-react";

// Claude-style Artifact Card with interactive selection
function CodeArtifactCard({ lang, code }: { lang: string; code: string }) {
  // Infer smart filename from code content or first line
  let inferredName = `snippet.${lang || "txt"}`;
  const firstLine = code.split("\n")[0] || "";
  
  if (firstLine.includes("export default function") || firstLine.includes("export function")) {
    const match = firstLine.match(/(?:function\s+)([A-Za-z0-9_]+)/);
    if (match) inferredName = `${match[1]}.${lang === "typescript" ? "tsx" : lang === "javascript" ? "jsx" : "ts"}`;
  } else if (firstLine.includes("const ") && firstLine.includes("=")) {
    const match = firstLine.match(/const\s+([A-Za-z0-9_]+)/);
    if (match) inferredName = `${match[1]}.${lang || "ts"}`;
  } else if (code.includes("interface ") || code.includes("type ")) {
    const match = code.match(/(?:interface|type)\s+([A-Za-z0-9_]+)/);
    if (match) inferredName = `${match[1].toLowerCase()}.ts`;
  }

  const handleInspect = () => {
    window.dispatchEvent(new CustomEvent("hiraya-inspect-code", { detail: { code, lang, filename: inferredName } }));
  };

  return (
    <div
      onClick={handleInspect}
      className="my-3 flex cursor-pointer items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 shadow-sm transition hover:border-(--persona)/50 hover:bg-raised"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--persona)/15 text-(--persona)">
          <FileCode className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-fg font-mono">{inferredName}</div>
          <div className="font-mono text-[10px] text-fg-subtle uppercase tracking-wider">{lang || "code snippet"}</div>
        </div>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1 font-mono text-[11px] text-fg-muted transition hover:text-fg">
        <span>Preview</span>
        <ExternalLink className="size-3" />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const styled = (Tag: any, cls: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function Styled({ node, className, ...rest }: any) {
    void node;
    return <Tag {...rest} className={`${cls} ${className ?? ""}`} />;
  };

const components: Components = {
  h1: styled("h1", "mt-5 mb-2 text-lg font-semibold tracking-tight text-fg first:mt-0"),
  h2: styled("h2", "mt-5 mb-2 border-b border-line pb-1 text-[15px] font-semibold text-fg first:mt-0"),
  h3: styled("h3", "mt-4 mb-1.5 text-sm font-semibold text-fg first:mt-0"),
  h4: styled("h4", "mt-3 mb-1 text-sm font-medium text-fg-muted"),
  p: styled("p", "my-2 leading-relaxed first:mt-0 last:mb-0"),
  ul: styled("ul", "my-2 list-disc space-y-1 pl-5 marker:text-fg-subtle [&:has(.task-list-item)]:list-none [&:has(.task-list-item)]:pl-0"),
  ol: styled("ol", "my-2 list-decimal space-y-1 pl-5 marker:text-fg-subtle"),
  li: styled("li", "leading-relaxed"),
  strong: styled("strong", "font-semibold text-fg"),
  hr: styled("hr", "my-4 border-line"),
  blockquote: styled("blockquote", "my-3 border-l-2 border-(--persona)/60 pl-3 text-fg-muted"),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-(--persona) underline decoration-(--persona)/40 underline-offset-2 hover:decoration-(--persona)">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[13px]">{children}</table>
    </div>
  ),
  th: styled("th", "border-b border-line bg-raised px-3 py-1.5 font-medium text-fg-muted whitespace-nowrap"),
  td: styled("td", "border-b border-line px-3 py-1.5 align-top"),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children).replace(/\n$/, "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    
    if (!lang && !text.includes("\n")) {
      return <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[0.85em] text-fg">{children}</code>;
    }

    return <CodeArtifactCard lang={lang ?? "text"} code={text} />;
  },
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <span
        aria-hidden
        className={`mr-2 inline-flex size-4 translate-y-0.75 items-center justify-center rounded border ${
          checked ? "border-(--persona) bg-(--persona)/20 text-(--persona)" : "border-line-strong"
        }`}
      >
        {checked && <Check className="size-3" />}
      </span>
    ) : null,
};

export const Markdown = memo(function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`text-sm text-fg/90 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});