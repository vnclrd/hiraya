"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Code2, FileText, RefreshCw, X } from "lucide-react";
import { Markdown } from "./markdown";
import { Tooltip } from "./tooltip";

type Memory = { context: string; progress: string };
type Key = keyof Memory;

const TABS: { id: Key; file: string }[] = [
  { id: "context", file: "CONTEXT.md" },
  { id: "progress", file: "PROGRESS.md" },
];

export function useProjectMemory(slug: string) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [unseen, setUnseen] = useState<Record<Key, boolean>>({ context: false, progress: false });
  const prev = useRef<Memory | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/projects?project=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error("bad response");
      const next: Memory = await res.json();
      const p = prev.current;
      if (p) {
        setUnseen((u) => ({
          context: u.context || p.context !== next.context,
          progress: u.progress || p.progress !== next.progress,
        }));
      }
      prev.current = next;
      setMemory(next);
      setUpdatedAt(Date.now());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    prev.current = null;
    setMemory(null);
    refresh();
  }, [refresh]);

  const markSeen = useCallback((k: Key) => setUnseen((u) => ({ ...u, [k]: false })), []);
  return { memory, loading, error, updatedAt, unseen, refresh, markSeen };
}

function ago(ts: number | null, now: number) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

export function MemoryPanel({
  mem,
  open,
  onClose,
}: {
  mem: ReturnType<typeof useProjectMemory>;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Key>("progress");
  const [raw, setRaw] = useState(false);
  const [now, setNow] = useState(0);
  const { memory, loading, error, updatedAt, unseen, refresh, markSeen } = mem;

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const select = (k: Key) => {
    setTab(k);
    markSeen(k);
  };
  const content = memory?.[tab] ?? "";

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-40 flex w-[min(30rem,100vw)] flex-col border-l border-line bg-surface transition-transform duration-300 xl:static xl:z-auto xl:w-md xl:translate-x-0 ${
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
              onClick={() => setRaw((r) => !r)}
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

      <div key={`${tab}-${raw}`} className="min-h-0 flex-1 animate-rise overflow-y-auto p-4">
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
    </aside>
  );
}