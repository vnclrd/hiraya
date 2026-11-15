"use client";

import { MessageSquare } from "lucide-react";
import { GENERAL, PERSONAS } from "@/config/modes";
import { Avatar } from "@/components/ui/avatar";

export function Sidebar({ view, onSelect }: { view: string; onSelect: (id: string) => void }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <span className="size-2.5 rounded-full bg-(--persona) shadow-[0_0_12px_var(--persona)]" />
        <h1 className="text-sm font-semibold tracking-tight">Hiraya</h1>
        <span className="text-xs text-fg-subtle">workspace</span>
      </div>

      <div className="p-2">
        <button
          type="button"
          onClick={() => onSelect("general")}
          aria-current={view === "general"}
          style={{ "--p": GENERAL.accent } as React.CSSProperties}
          className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-left transition duration-200 ${
            view === "general" ? "border-(--p)/40 bg-(--p)/8 shadow-[0_0_28px_-12px_var(--p)]" : "border-transparent hover:border-line hover:bg-raised"
          }`}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--p)/15 text-(--p) ring-1 ring-(--p)/30">
            <MessageSquare className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between">
              <span className="text-sm font-medium">General chat</span>
              <kbd className="font-mono text-[10px] text-fg-subtle opacity-0 transition group-hover:opacity-100">⌥0</kbd>
            </span>
            <span className="block truncate text-[11px] text-fg-muted">Ask anything</span>
          </span>
        </button>
      </div>

      <p className="px-4 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">AI personas</p>
      <nav aria-label="Personas" className="flex-1 space-y-1 overflow-y-auto p-2 pt-0">
        {PERSONAS.map((p, i) => {
          const active = p.id === view;
          return (
            <button
              key={p.id}
              type="button"
              style={{ "--p": p.accent } as React.CSSProperties}
              onClick={() => onSelect(p.id)}
              aria-current={active}
              className={`group flex w-full cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-left transition duration-200 ${
                active ? "border-(--p)/40 bg-(--p)/8 shadow-[0_0_28px_-12px_var(--p)]" : "border-transparent hover:border-line hover:bg-raised"
              }`}
            >
              <Avatar bot={p} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.name}</span>
                  <kbd className="font-mono text-[10px] text-fg-subtle opacity-0 transition group-hover:opacity-100">⌥{i + 1}</kbd>
                </span>
                <span className="block truncate text-[11px] text-fg-muted">{p.title}</span>
                <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-fg-subtle">{p.description}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
