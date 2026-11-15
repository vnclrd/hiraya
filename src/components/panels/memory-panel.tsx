"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, BookOpen, Code2, FileText, RefreshCw, X } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { Tooltip } from "@/components/ui/tooltip";
import type { MemoryKey, useProjectMemory } from "@/hooks/use-project-memory";

const TABS: { id: MemoryKey; file: string }[] = [
  { id: "context", file: "CONTEXT.md" },
  { id: "progress", file: "PROGRESS.md" },
];

function ago(ts: number | null, now: number) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/**
 * Project memory. Docked on the right at xl+ (always visible); a slide-over below xl.
 * Always opens scrolled to the newest content (the bottom), and follows new entries
 * unless you scroll up — then a "Latest" button appears.
 */
export function MemoryPanel({
  mem,
  open,
  onClose,
}: {
  mem: ReturnType<typeof useProjectMemory>;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<MemoryKey>("progress");
  const [raw, setRaw] = useState(false);
  const [now, setNow] = useState(0); // set after mount so prerender never reads the clock
  const [pinned, setPinned] = useState(true); // true while the reader is at the bottom
  const body = useRef<HTMLDivElement>(null);
  const force = useRef(true); // force a jump to bottom (tab/format switch, first load)
  const { memory, loading, error, updatedAt, unseen, refresh, markSeen } = mem;
  const content = memory?.[tab] ?? "";

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const toBottom = useCallback((smooth = false) => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Scroll to the newest content whenever it changes (or on tab/format switch)
  useEffect(() => {
    if (!force.current && !pinned) return;
    const id = requestAnimationFrame(() => {
      toBottom();
      force.current = false;
      setPinned(true);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, tab, raw, loading, error, toBottom]);

  // Opening the slide-over on small screens should also land on the newest entry
  useEffect(() => { if (open) force.current = true; }, [open]);

  const select = (k: MemoryKey) => {
    force.current = true;
    setTab(k);
    markSeen(k);
  };

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-30 flex w-[min(30rem,100vw)] shrink-0 flex-col border-l border-line bg-surface transition-transform duration-300 xl:static xl:z-auto xl:w-md xl:translate-x-0 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wider text-fg-muted uppercase">
          <FileText className="size-4 text-(--persona)" /> Project memory
        </span>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[11px] text-fg-subtle">{ago(updatedAt, now)}</span>
          <Tooltip label={raw ? "Show rendered" : "Show raw markdown"} side="bottom">
            <button
              type="button"
              onClick={() => { force.current = true; setRaw((r) => !r); }}
              aria-label="Toggle raw markdown"
              className="cursor-pointer rounded-md p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg"
            >
              {raw ? <BookOpen className="size-4" /> : <Code2 className="size-4" />}
            </button>
          </Tooltip>
          <Tooltip label="Reload CONTEXT.md & PROGRESS.md from disk" side="bottom">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh project memory"
              className="cursor-pointer rounded-md p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="cursor-pointer rounded-md p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg xl:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-3 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => select(t.id)}
            className={`relative cursor-pointer rounded-t-md px-3 py-2 font-mono text-xs transition ${
              tab === t.id ? "text-fg" : "text-fg-subtle hover:text-fg-muted"
            }`}
          >
            {t.file}
            {unseen[t.id] && tab !== t.id && (
              <span className="absolute top-2 right-0.5 size-1.5 rounded-full bg-(--persona)" aria-label="Updated" />
            )}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-px bg-(--persona)" />}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          key={`${tab}-${raw}`}
          ref={body}
          onScroll={(e) => {
            const el = e.currentTarget;
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
          }}
          className="h-full animate-rise overflow-y-auto p-4"
        >
          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertTriangle className="size-4 shrink-0" /> Couldn&apos;t load project files.
              <button onClick={refresh} className="ml-auto cursor-pointer underline">Retry</button>
            </div>
          ) : loading && !memory ? (
            <div className="space-y-2.5" aria-busy>
              {[90, 70, 82, 55, 76, 64].map((w, i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-raised" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : raw ? (
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-muted">{content}</pre>
          ) : (
            <Markdown>{content}</Markdown>
          )}
        </div>

        {!pinned && (
          <button
            type="button"
            onClick={() => toBottom(true)}
            aria-label="Jump to latest"
            className="animate-rise absolute right-4 bottom-3 flex cursor-pointer items-center gap-1 rounded-full border border-line-strong bg-raised px-3 py-1.5 text-[11px] text-fg-muted shadow-lg transition hover:text-fg"
          >
            <ArrowDown className="size-3.5" /> Latest
          </button>
        )}
      </div>
    </aside>
  );
}
