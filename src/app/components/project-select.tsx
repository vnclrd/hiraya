"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderGit2, Plus, Search } from "lucide-react";

export const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, ""); // mirrors server-side slug cleaning

type Item = { kind: "none" } | { kind: "project"; slug: string } | { kind: "create"; slug: string };

export function ProjectSelect({
  value,
  projects,
  loading,
  onChange,
}: {
  value: string; // "" = no project
  projects: string[];
  loading: boolean;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setIdx(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);

  const q = sanitize(query);
  const filtered = projects.filter((p) => p.toLowerCase().includes(q.toLowerCase()));
  const items: Item[] = [
    ...(!q ? [{ kind: "none" } as Item] : []),
    ...filtered.map((slug) => ({ kind: "project", slug }) as Item),
    ...(q && !projects.includes(q) ? [{ kind: "create", slug: q } as Item] : []),
  ];

  const pick = (it?: Item) => {
    if (!it) return;
    onChange(it.kind === "none" ? "" : it.slug);
    close();
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select project"
        className="flex max-w-[16rem] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs transition hover:border-line-strong hover:bg-raised focus-visible:border-(--persona)/60 focus-visible:outline-hidden"
      >
        <FolderGit2 className="size-3.5 shrink-0 text-(--persona)" />
        <span className={`truncate font-mono ${value ? "text-fg" : "text-fg-subtle"}`}>{value || "No project"}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-fg-subtle transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="animate-rise absolute top-full left-1/2 z-50 mt-2 w-72 -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl">
          <label className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search className="size-3.5 text-fg-subtle" />
            <input
              ref={input}
              value={query}
              onChange={(e) => {
                setQuery(sanitize(e.target.value));
                setIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter") { e.preventDefault(); pick(items[idx]); }
              }}
              placeholder="Search or create a project…"
              aria-label="Search projects"
              className="w-full bg-transparent text-xs outline-hidden placeholder:text-fg-subtle"
            />
          </label>
          <ul role="listbox" className="max-h-64 overflow-y-auto p-1.5">
            {loading && <li className="px-3 py-2 text-xs text-fg-subtle">Loading projects…</li>}
            {!loading && projects.length === 0 && !q && (
              <li className="px-3 py-2 text-xs text-fg-subtle">No projects yet — type a name to create one.</li>
            )}
            {items.map((it, i) => {
              const selected = it.kind === "none" ? value === "" : it.kind === "project" && it.slug === value;
              return (
                <li
                  key={`${it.kind}:${"slug" in it ? it.slug : ""}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(it)}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs ${
                    i === idx ? "bg-(--persona)/10 text-fg" : "text-fg-muted"
                  }`}
                >
                  {it.kind === "create" ? (
                    <>
                      <Plus className="size-3.5 text-(--persona)" />
                      <span>Create <span className="font-mono text-fg">{it.slug}</span></span>
                    </>
                  ) : (
                    <>
                      <FolderGit2 className="size-3.5 shrink-0" />
                      <span className={`truncate ${it.kind === "project" ? "font-mono" : "italic"}`}>
                        {it.kind === "none" ? "No project (scratch space)" : it.slug}
                      </span>
                      {selected && <Check className="ml-auto size-3.5 text-(--persona)" />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}