"use client";

import type { ReactNode } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { GENERAL, PERSONAS } from "@/config/modes";
import { HIRAYA_PERSONAS } from "@/config/personas";
import type { Activity } from "@/hooks/use-office";
import { Avatar } from "@/components/ui/avatar";
import { accent } from "@/lib/accent";

type ItemProps = {
  accentColor: string;
  active: boolean;
  hotkey: string;
  leading: ReactNode;
  title: string;
  subtitle: string;
  tooltip?: string;
  badge?: ReactNode;
  onClick: () => void;
};

/** Status dot / spinner shown on a persona's row while a handed-off task runs or has finished. */
function Badge({ a }: { a?: Activity }) {
  if (!a) return null;
  if (a.state === "working")
    return <Loader2 aria-label="Working" className="size-3.5 shrink-0 animate-spin text-(--persona)" />;
  if (a.state === "error")
    return <span aria-label="Failed" className="size-2 shrink-0 rounded-full bg-red-400" />;
  return (
    <span aria-label="New result" className="relative flex size-2.5 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--persona) opacity-60" />
      <span className="relative inline-flex size-2.5 rounded-full bg-(--persona)" />
    </span>
  );
}

/** One row of the sidebar: same layout for General chat and every persona. */
function NavItem({ accentColor, active, hotkey, leading, title, subtitle, tooltip, badge, onClick }: ItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-current={active ? "page" : undefined}
      style={accent(accentColor)}
      className={`relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-(--persona)/60 ${
        active ? "bg-raised" : "hover:bg-raised/60"
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-2 left-0 w-0.5 rounded-full bg-(--persona) transition-opacity duration-150 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      {leading}
      <span className="min-w-0 flex-1 leading-tight">
        <span className={`block truncate text-sm ${active ? "font-semibold text-fg" : "font-medium text-fg/90"}`}>
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-fg-muted">{subtitle}</span>
      </span>
      {badge}
      <kbd className="shrink-0 font-mono text-[10px] text-fg-subtle tabular-nums">{hotkey}</kbd>
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">{children}</p>
  );
}

export function Sidebar({
  view,
  onSelect,
  activity = {},
}: {
  view: string;
  onSelect: (id: string) => void;
  /** Badge state per persona id (working / unread / error) for the current project. */
  activity?: Record<string, Activity | undefined>;
}) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="size-2.5 rounded-full bg-(--persona) shadow-[0_0_12px_var(--persona)]" />
        <h1 className="text-sm font-semibold tracking-tight">Hiraya</h1>
        <span className="text-xs text-fg-subtle">workspace</span>
      </div>

      <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-2">
        <SectionLabel>Chat</SectionLabel>
        <NavItem
          accentColor={GENERAL.accent}
          active={view === "general"}
          hotkey="⌥0"
          title="General chat"
          subtitle="Ask anything"
          onClick={() => onSelect("general")}
          leading={
            <span
              style={accent(GENERAL.accent)}
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--persona)/15 text-(--persona) ring-1 ring-(--persona)/30"
            >
              <MessageSquare className="size-4" />
            </span>
          }
        />

        <SectionLabel>Personas</SectionLabel>
        <div className="space-y-0.5">
          {PERSONAS.map((p, i) => {
            const a = activity[p.id];
            const from = a?.from ? (HIRAYA_PERSONAS[a.from]?.name ?? a.from) : null;
            return (
              <NavItem
                key={p.id}
                accentColor={p.accent}
                active={p.id === view}
                hotkey={`⌥${i + 1}`}
                title={p.name}
                subtitle={p.title}
                tooltip={a?.task ? `Task from ${from}: ${a.task}` : p.description}
                badge={<Badge a={a} />}
                onClick={() => onSelect(p.id)}
                leading={<Avatar bot={p} />}
              />
            );
          })}
        </div>
      </nav>

      <div className="shrink-0 border-t border-line px-4 py-3 text-[11px] text-fg-subtle">
        <span className="font-mono">⌘/</span> memory <span className="mx-1.5">·</span>
        <span className="font-mono">⌘.</span> code
      </div>
    </aside>
  );
}