"use client";

import { AlertTriangle, BookMarked, Check, FileCode, FileText, Loader2, PanelLeft, Plus } from "lucide-react";
import type { PersonaConfig } from "@/config/personas";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { ProjectSelect } from "@/components/project/project-select";

const ICON_BTN =
  "cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg";

type Props = {
  bot: PersonaConfig;
  isGeneral: boolean;
  landing: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  project: { slug: string; options: string[]; loading: boolean; onChange: (s: string) => void };
  notice: { text: string; ok: boolean } | null;
  modelUsed: string | null;
  showNewChat: boolean;
  onNewChat: () => void;
  onToggleMemory: () => void;
  artifactCount: number;
  codeOpen: boolean;
  onToggleCode: () => void;
  wrap: { busy: boolean; canWrap: boolean; hasProject: boolean; onWrap: () => void };
};

export function AppHeader(p: Props) {
  const { bot, isGeneral } = p;
  return (
    <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden md:inline-flex">
          <Tooltip label={p.sidebarOpen ? "Hide sidebar" : "Show sidebar"} side="bottom">
            <button type="button" onClick={p.onToggleSidebar} aria-label="Toggle sidebar" className={ICON_BTN}>
              <PanelLeft className="size-4" />
            </button>
          </Tooltip>
        </span>
        <Avatar bot={bot} />
        <div className="hidden min-w-0 leading-tight sm:block">
          <div className="truncate text-sm font-semibold">{isGeneral ? "General chat" : bot.name}</div>
          <div className="truncate text-[11px] text-fg-muted">{isGeneral ? "Ask anything" : bot.title}</div>
        </div>
      </div>

      <ProjectSelect
        value={p.project.slug}
        projects={p.project.options}
        loading={p.project.loading}
        onChange={p.project.onChange}
      />

      <div className="flex items-center justify-end gap-2">
        {p.notice && (
          <span
            className={`animate-rise hidden items-center gap-1 text-xs xl:flex ${p.notice.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {p.notice.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />} {p.notice.text}
          </span>
        )}
        {p.modelUsed && (
          <span
            className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle xl:inline"
            title="Model that served the last reply"
          >
            {p.modelUsed}
          </span>
        )}
        {p.showNewChat && (
          <Tooltip label="Start a new chat" side="bottom">
            <button type="button" onClick={p.onNewChat} aria-label="New chat" className={ICON_BTN}>
              <Plus className="size-4" />
            </button>
          </Tooltip>
        )}
        {!p.landing && (
          <>
            <Tooltip label="Project memory" hint="⌘/" side="bottom">
              <button
                type="button"
                onClick={p.onToggleMemory}
                aria-label="Toggle project memory"
                className={`${ICON_BTN} xl:hidden`}
              >
                <FileText className="size-4" />
              </button>
            </Tooltip>
            {p.artifactCount > 0 && (
              <Tooltip label={p.codeOpen ? "Hide code preview" : "Show code preview"} hint="⌘." side="bottom">
                <button
                  type="button"
                  onClick={p.onToggleCode}
                  aria-label="Toggle code preview"
                  data-keep-code-open
                  aria-pressed={p.codeOpen}
                  className={`relative cursor-pointer rounded-md border p-1.5 transition ${
                    p.codeOpen
                      ? "border-(--persona)/50 bg-(--persona)/10 text-(--persona)"
                      : "border-line text-fg-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  <FileCode className="size-4" />
                  <span className="absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full bg-(--persona) px-1 text-[9px] font-semibold text-canvas">
                    {p.artifactCount}
                  </span>
                </button>
              </Tooltip>
            )}
            <Tooltip
              label={
                p.wrap.hasProject
                  ? "Summarize this chat into PROGRESS.md and start fresh"
                  : "Pick a project to wrap this session"
              }
              hint="/wrap"
              side="bottom"
            >
              <button
                type="button"
                onClick={p.wrap.onWrap}
                disabled={p.wrap.busy || !p.wrap.canWrap}
                aria-label="Wrap session"
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {p.wrap.busy ? <Loader2 className="size-3.5 animate-spin" /> : <BookMarked className="size-3.5" />}
                <span className="hidden lg:inline">{p.wrap.busy ? "Wrapping…" : "Wrap session"}</span>
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  );
}
