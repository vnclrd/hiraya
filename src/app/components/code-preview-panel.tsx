"use client";

import { useEffect, useState } from "react";
import { Check, Copy, FileCode, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { Tooltip } from "./tooltip";

export function CodePreviewPanel({
  messages,
  open,
  onClose,
  projectSlug,
}: {
  messages: any[];
  open: boolean;
  onClose: () => void;
  projectSlug: string;
}) {
  const [copied, setCopied] = useState(false);
  const [selectedCode, setSelectedCode] = useState<{ code: string; lang: string; filename: string } | null>(null);

  let activeCode = selectedCode?.code;
  let activeLang = selectedCode?.lang;
  let activeFilename = selectedCode?.filename;

  if (!activeCode) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.parts) {
        for (const p of m.parts) {
          if (p.type === "text" && p.text) {
            const match = /```(\w*)\n([\s\S]*?)```/.exec(p.text);
            if (match) {
              activeLang = match[1] || "text";
              activeCode = match[2];
              activeFilename = `snippet.${activeLang}`;
              break;
            }
          }
        }
        if (activeCode) break;
      }
    }
  }

  activeCode = activeCode || "// Click 'Preview' on any artifact card in the chat to inspect its code here...";
  activeLang = activeLang || "typescript";
  activeFilename = activeFilename || "workspace-preview";

  useEffect(() => {
    const handleInspect = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setSelectedCode({
          code: customEvent.detail.code,
          lang: customEvent.detail.lang,
          filename: customEvent.detail.filename,
        });
      }
    };
    window.addEventListener("hiraya-inspect-code", handleInspect);
    return () => window.removeEventListener("hiraya-inspect-code", handleInspect);
  }, []);

  useEffect(() => {
    setSelectedCode(null);
  }, [messages.length]);

  const copy = async () => {
    await navigator.clipboard.writeText(activeCode!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-40 flex flex-col border-l border-line bg-surface transition-all duration-300 ease-in-out xl:relative ${
        open
          ? "w-[min(42rem,100vw)] xl:w-175 translate-x-0 opacity-100"
          : "w-0 xl:w-0 translate-x-full opacity-0 overflow-hidden border-l-0"
      }`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 bg-raised/50 whitespace-nowrap">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wider text-fg-muted uppercase font-mono truncate">
          <FileCode className="size-4 text-(--persona) shrink-0" /> Code Preview ({projectSlug})
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip label="Copy code" side="bottom">
            <button
              type="button"
              onClick={copy}
              aria-label="Copy code"
              className="flex cursor-pointer items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-fg-muted transition hover:bg-raised hover:text-fg"
            >
              {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </Tooltip>
          <Tooltip label="Close panel" side="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="cursor-pointer rounded-md p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 font-mono text-[11px] text-fg-subtle whitespace-nowrap">
        <span className="truncate">{activeFilename}</span>
        <span className="uppercase">{activeLang}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-4 min-w-175">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-md">
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={activeLang || "text"}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: "1.2rem",
              background: "transparent",
              fontSize: "12.5px",
              lineHeight: "1.6",
            }}
            codeTagProps={{
              style: { background: "transparent" },
            }}
            {...({} as any)}
          >
            {activeCode}
          </SyntaxHighlighter>
        </div>
      </div>
    </aside>
  );
}