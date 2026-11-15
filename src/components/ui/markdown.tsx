"use client";

import { createContext, memo, useContext, useMemo } from "react";
import { codeKey, pathsByCode } from "@/lib/artifacts";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm"; // npm i remark-gfm  (tables + task lists)
import { Check, FileCode, ExternalLink } from "lucide-react";

function getCleanExtension(lang: string, filename?: string): string {
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) return ext;
  }
  const map: Record<string, string> = {
    typescript: "ts",
    tsx: "tsx",
    javascript: "js",
    jsx: "jsx",
    python: "py",
    json: "json",
    css: "css",
    html: "html",
    markdown: "md",
  };
  return map[lang.toLowerCase()] || lang.toLowerCase() || "txt";
}

// Claude-style Artifact Card using the exact path above it
function CodeArtifactCard({ lang, code, detectedPath }: { lang: string; code: string; detectedPath?: string }) {
  const ext = getCleanExtension(lang, detectedPath);
  
  // Use the exact filename from the path above (e.g. personas.ts from src/config/personas.ts)
  const finalFilename = detectedPath ? detectedPath.split("/").pop() : `Code`;

  const handleInspect = () => {
    window.dispatchEvent(
      new CustomEvent("hiraya-inspect-code", {
        detail: { code, lang, filename: finalFilename, path: detectedPath },
      })
    );
  };

  return (
    <div
      onClick={handleInspect}
      data-keep-code-open
      className="my-3 flex cursor-pointer items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 shadow-sm transition hover:border-(--persona)/50 hover:bg-raised"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--persona)/15 text-(--persona)">
          <FileCode className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-fg font-mono">{finalFilename}</div>
          <div className="font-mono text-[10px] text-fg-subtle uppercase tracking-wider">.{ext}</div>
        </div>
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

const CodePathsContext = createContext<Map<string, string>>(new Map());

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const detectedPath = useContext(CodePathsContext).get(codeKey(code));
  return <CodeArtifactCard lang={lang} code={code} detectedPath={detectedPath} />;
}

const components: Components = {
  h1: styled("h1", "mt-5 mb-2 text-lg font-semibold tracking-tight text-fg first:mt-0"),
  h2: styled("h2", "mt-5 mb-2 border-b border-line pb-1 text-[15px] font-semibold text-fg first:mt-0"),
  h3: styled("h3", "mt-4 mb-1.5 text-sm font-semibold text-fg first:mt-0"),
  h4: styled("h4", "mt-3 mb-1 text-sm font-medium text-fg-muted"),
  p: styled("p", "my-2 leading-relaxed first:mt-0 last:mb-0"),
  ul: styled("ul", "my-2 list-disc space-y-1 pl-5 marker:text-fg-subtle"),
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
    const langMatch = /language-([a-zA-Z0-9_-]+)/.exec(className ?? "");
    const lang = langMatch ? langMatch[1] : "";

        if (!lang && !text.includes("\n")) {
      return <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[0.85em] text-fg">{children}</code>;
    }

    return <CodeBlock lang={lang || "text"} code={text} />;
  },
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <span aria-hidden className={`mr-2 inline-flex size-4 items-center justify-center rounded border ${checked ? "border-(--persona) bg-(--persona)/20 text-(--persona)" : "border-line-strong"}`}>{checked && <Check className="size-3" />}</span>
    ) : null,
};

export const Markdown = memo(function Markdown({ children, className = "" }: { children: string; className?: string }) {
  const paths = useMemo(() => pathsByCode(children), [children]);
  return (
    <div className={`text-sm text-fg/90 ${className}`}>
      <CodePathsContext.Provider value={paths}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {children}
        </ReactMarkdown>
      </CodePathsContext.Provider>
    </div>
  );
});