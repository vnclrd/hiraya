"use client";

import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm"; // npm i remark-gfm  (tables + task lists)
import { Check, Copy } from "lucide-react";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-fg-subtle">
        <span className="font-mono">{lang || "text"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-raised hover:text-fg"
        >
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className="font-mono text-fg">{code}</code>
      </pre>
    </div>
  );
}

// Strips react-markdown's `node` prop and merges a base class onto a tag.
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
    return <CodeBlock lang={lang ?? ""} code={text} />;
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