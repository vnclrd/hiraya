"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  AlertTriangle, ArrowDown, ArrowUp, BookMarked, Bug, Check, Code2, Copy, FileCode, FileText,
  Flame, FolderGit2, Layers, Loader2, MessageSquare, Plus, ShieldCheck, Square,
} from "lucide-react";
import { HIRAYA_PERSONAS, type PersonaConfig } from "@/config/personas";
import { Markdown } from "./components/markdown";
import { CodePreviewPanel } from "./components/code-preview-panel";
import { useProjectMemory } from "./components/memory-panel";
import { ProjectSelect, sanitize } from "./components/project-select";
import { Tooltip } from "./components/tooltip";

// General chat. Add a `general` entry to personas.ts (see reply) so the API uses its system prompt;
// this fallback only keeps the UI from crashing until you do.
const GENERAL: PersonaConfig = HIRAYA_PERSONAS.general ?? {
  ...HIRAYA_PERSONAS.violet,
  id: "general",
  name: "Hiraya",
  title: "General chat",
  accent: "#60a5fa",
  description: "Ask anything — brainstorm, learn, or think out loud.",
};
const PERSONAS = Object.values(HIRAYA_PERSONAS).filter((p) => p.id !== "general");

const accent = (c: string) => ({ "--persona": c }) as React.CSSProperties;

// ── Thread persistence (survives reloads) ──
const STORE = (k: string) => `hiraya:thread:${k}`;
const loadThread = (k: string): UIMessage[] | null => {
  try { const r = localStorage.getItem(STORE(k)); return r ? JSON.parse(r) : null; } catch { return null; }
};
const saveThread = (k: string, m: UIMessage[]) => {
  try { const s = JSON.stringify(m); if (s.length < 1_500_000) localStorage.setItem(STORE(k), s); } catch {}
};
const dropThread = (k: string) => { try { localStorage.removeItem(STORE(k)); } catch {} };

// Tool parts: static tools expose their name in `type` ("tool-readProjectFile"), dynamic ones in `toolName`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolName = (p: any): string => p.toolName ?? String(p.type).replace(/^tool-/, "");
const finishedWriteIds = (ms: UIMessage[]): string[] =>
  ms.flatMap((m) =>
    m.role !== "assistant"
      ? []
      : m.parts.flatMap((p, i) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          p.type.startsWith("tool-") && toolName(p) === "writeProjectFile" && (p as any).state === "output-available"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? [(p as any).toolCallId ?? `${m.id}:${i}`]
            : [],
        ),
  );

function Avatar({ bot, size = "md" }: { bot: PersonaConfig; size?: "sm" | "md" | "lg" }) {
  const dim = { sm: "size-6 text-[11px]", md: "size-8 text-sm", lg: "size-14 text-xl" }[size];
  return (
    <span
      style={accent(bot.accent)}
      className={`grid ${dim} shrink-0 place-items-center rounded-lg bg-(--persona)/15 font-semibold text-(--persona) ring-1 ring-(--persona)/30`}
    >
      {bot.name[0]}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy reply"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fg-subtle opacity-0 transition group-hover/msg:opacity-100 hover:bg-raised hover:text-fg focus-visible:opacity-100"
    >
      {done ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function HirayaPage() {
  const [view, setView] = useState<string>("general"); // "general" or a persona id — General is the landing view
  const [slug, setSlug] = useState("sample-project"); // "" = no project (scratch space)
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [greeting, setGreeting] = useState("Welcome back");
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [wrapping, setWrapping] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handledWrites = useRef<Set<string>>(new Set());
  const lastWrapped = useRef<Map<string, number>>(new Map());

  const isGeneral = view === "general";
  const bot = isGeneral ? GENERAL : (HIRAYA_PERSONAS[view] ?? GENERAL);
  const effSlug = slug || "general"; // "general" is the scratch folder on disk
  const mem = useProjectMemory(effSlug);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch("/api/projects/list");
      if (r.ok) setProjects((await r.json()).projects ?? []);
    } catch {} finally {
      setProjectsLoading(false);
    }
  }, []);

  // Boot: restore last project, resume view after an auto-reload, time-based greeting, project list
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hiraya:project");
      if (saved !== null) setSlug(sanitize(saved));
      const resume = sessionStorage.getItem("hiraya:resume");
      if (resume) { sessionStorage.removeItem("hiraya:resume"); setView(resume); }
      handledWrites.current = new Set(JSON.parse(sessionStorage.getItem("hiraya:writes") ?? "[]"));
    } catch {}
    const h = new Date().getHours();
    setGreeting(h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    loadProjects();
  }, [loadProjects]);
  useEffect(() => { try { localStorage.setItem("hiraya:project", slug); } catch {} }, [slug]);

  // One conversation per project + mode, so switching personas never mixes threads.
  const refreshRef = useRef(mem.refresh);
  useEffect(() => { refreshRef.current = mem.refresh; });
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          setModelUsed(res.headers.get("X-Model-Used"));
          return res;
        },
      }),
    [],
  );
  const [threads] = useState(() => new Map<string, Chat<UIMessage>>());
  const key = `${effSlug}:${bot.id}`;
  let chat = threads.get(key);
  if (!chat) {
    chat = new Chat<UIMessage>({ id: key, transport, onFinish: () => refreshRef.current() });
    threads.set(key, chat);
  }
  const { messages, setMessages, sendMessage, status, error, stop, regenerate } = useChat({ chat });
  const busy = status === "submitted" || status === "streaming";
  const landing = isGeneral && messages.length === 0;
  const canWrap = !!slug && messages.length > 0;

  // Restore a saved thread when its (project, mode) is opened; never trigger the reload hook for old writes
  useEffect(() => {
    const stored = loadThread(key);
    if (!stored?.length) return;
    finishedWriteIds(stored).forEach((id) => handledWrites.current.add(id));
    setMessages((prev) => (prev.length ? prev : stored));
  }, [key, setMessages]);
  useEffect(() => { if (messages.length && !busy) saveThread(key, messages); }, [messages, busy, key]);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3000);
  };

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    if (text.trim().toLowerCase() === "/wrap") return void wrap(true);
    sendMessage({ text }, { body: { personaId: bot.id, projectSlug: effSlug } });
  };

  const wrap = async (clear = false) => {
    if (messages.length === 0 || wrapping) return;
    if (!slug) return flash("Pick a project first to wrap into its PROGRESS.md", false);
    setWrapping(true);
    try {
      const res = await fetch("/api/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, projectSlug: slug, personaName: bot.name }),
      });
      if (!res.ok) throw new Error();
      lastWrapped.current.set(key, messages.length);
      await mem.refresh();
      loadProjects();
      if (clear) { setMessages([]); dropThread(key); lastWrapped.current.delete(key); }
      flash("Session wrapped into PROGRESS.md & transcript saved");
    } catch {
      flash("Couldn't wrap session — try again", false);
    } finally {
      setWrapping(false);
    }
  };

  const newChat = () => { setMessages([]); dropThread(key); setInput(""); composerRef.current?.focus(); };

  // ── IDLE AUTO-WRAP (30 min) — only once per unchanged conversation (fixes repeat-wrap loop) ──
  useEffect(() => {
    if (!canWrap || wrapping || busy || lastWrapped.current.get(key) === messages.length) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => wrap(false), 30 * 60 * 1000);
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, arm));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, wrapping, busy, canWrap, key]);

  // ── RELOAD AFTER NEW FILE WRITES (each tool call handled once; threads + view survive the reload) ──
  useEffect(() => {
    const fresh = finishedWriteIds(messages).filter((id) => !handledWrites.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => handledWrites.current.add(id));
    try {
      sessionStorage.setItem("hiraya:writes", JSON.stringify([...handledWrites.current]));
      sessionStorage.setItem("hiraya:resume", view);
    } catch {}
    saveThread(key, messages);
    const t = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(t);
  }, [messages, view, key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
    setInput("");
  };

  // Auto-scroll only while the user is near the bottom
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight });
  }, [messages, status, atBottom]);

  // Keep the composer height in sync (also resets after send and when a quick action prefills it)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, landing]);
  useEffect(() => { composerRef.current?.focus(); }, [view, landing]);

  // Shortcuts: Alt+0 General, Alt+1..6 personas, Ctrl/Cmd+/ code preview, "/" focus composer, Esc stop
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.altKey && /^Digit[0-6]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        setView(n === 0 ? "general" : (PERSONAS[n - 1]?.id ?? "general"));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setPanelOpen((o) => !o); }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); composerRef.current?.focus(); }
      if (e.key === "Escape" && busy) stop();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, stop]);

  const options = slug && !projects.includes(slug) ? [slug, ...projects] : projects;

  const composer = (
    <form onSubmit={submit} className={landing ? "w-full" : "mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"}>
      <div
        className={`rounded-2xl border border-line-strong bg-surface transition focus-within:border-(--persona)/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--persona)_14%,transparent)] ${
          landing ? "p-1.5 shadow-2xl" : "shadow-lg"
        }`}
      >
        <textarea
          ref={composerRef}
          value={input}
          rows={landing ? 2 : 1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={landing ? "Ask anything, or pick a persona below…" : `Ask ${bot.name} about ${slug || "anything"}…`}
          aria-label="Message"
          className={`block max-h-52 w-full resize-none bg-transparent px-4 pt-3 pb-1 outline-hidden placeholder:text-fg-subtle ${landing ? "text-base" : "text-sm"}`}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <span className="text-[11px] text-fg-subtle">
            {landing ? (
              <><kbd className="font-mono">Enter</kbd> send · <kbd className="font-mono">/</kbd> focus · <kbd className="font-mono">⌥0–6</kbd> switch mode</>
            ) : (
              <><kbd className="font-mono">Enter</kbd> send · <kbd className="font-mono">Shift+Enter</kbd> newline · <kbd className="font-mono">Esc</kbd> stop · <kbd className="font-mono">/wrap</kbd> end session</>
            )}
          </span>
          {busy ? (
            <Tooltip label="Stop generating" hint="Esc" side="top">
              <button type="button" onClick={() => stop()} aria-label="Stop" className="grid size-8 cursor-pointer place-items-center rounded-lg border border-line-strong text-fg transition hover:bg-raised">
                <Square className="size-3.5 fill-current" />
              </button>
            </Tooltip>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              className="grid size-8 cursor-pointer place-items-center rounded-lg bg-(--persona) text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );

  return (
    <div style={accent(bot.accent)} className="flex h-dvh bg-canvas text-fg">
      {/* ── Sidebar: General chat on top, then personas ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="size-2.5 rounded-full bg-(--persona) shadow-[0_0_12px_var(--persona)]" />
          <h1 className="text-sm font-semibold tracking-tight">Hiraya</h1>
          <span className="text-xs text-fg-subtle">workspace</span>
        </div>

        <div className="p-2">
          <button
            type="button"
            onClick={() => setView("general")}
            aria-current={isGeneral}
            style={{ "--p": GENERAL.accent } as React.CSSProperties}
            className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-left transition duration-200 ${
              isGeneral ? "border-(--p)/40 bg-(--p)/8 shadow-[0_0_28px_-12px_var(--p)]" : "border-transparent hover:border-line hover:bg-raised"
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
                onClick={() => setView(p.id)}
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

      {/* ── Main ── */}
      <main className="ambient relative flex min-w-0 flex-1 flex-col">
        {/* Header: identity | centered project dropdown | actions */}
        <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar bot={bot} />
            <div className="hidden min-w-0 leading-tight sm:block">
              <div className="truncate text-sm font-semibold">{isGeneral ? "General chat" : bot.name}</div>
              <div className="truncate text-[11px] text-fg-muted">{isGeneral ? "Ask anything" : bot.title}</div>
            </div>
          </div>

          <ProjectSelect value={slug} projects={options} loading={projectsLoading} onChange={setSlug} />

          <div className="flex items-center justify-end gap-2">
            {notice && (
              <span className={`animate-rise hidden items-center gap-1 text-xs xl:flex ${notice.ok ? "text-emerald-400" : "text-red-400"}`}>
                {notice.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />} {notice.text}
              </span>
            )}
            {modelUsed && (
              <span className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle xl:inline" title="Model that served the last reply">
                {modelUsed}
              </span>
            )}
            {isGeneral && messages.length > 0 && (
              <Tooltip label="Start a new chat" side="bottom">
                <button type="button" onClick={newChat} aria-label="New chat" className="cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg">
                  <Plus className="size-4" />
                </button>
              </Tooltip>
            )}
            {!landing && (
              <>
                <Tooltip label="Toggle Code Preview" hint="⌘/" side="bottom">
                  <button type="button" onClick={() => setPanelOpen((o) => !o)} aria-label="Toggle Code Preview" className="cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg">
                    <FileCode className="size-4" />
                  </button>
                </Tooltip>
                <Tooltip label={slug ? "Summarize this chat into PROGRESS.md and start fresh" : "Pick a project to wrap this session"} hint="/wrap" side="bottom">
                  <button
                    type="button"
                    onClick={() => wrap(true)}
                    disabled={wrapping || !canWrap}
                    aria-label="Wrap session"
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {wrapping ? <Loader2 className="size-3.5 animate-spin" /> : <BookMarked className="size-3.5" />}
                    <span className="hidden lg:inline">{wrapping ? "Wrapping…" : "Wrap session"}</span>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </header>

        {/* Mobile mode strip */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-line p-2 md:hidden">
          {[GENERAL, ...PERSONAS].map((p) => (
            <button
              key={p.id}
              onClick={() => setView(p.id)}
              style={{ "--p": p.accent } as React.CSSProperties}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
                p.id === bot.id ? "border-(--p)/50 bg-(--p)/10 text-fg" : "border-line text-fg-muted"
              }`}
            >
              {p.id === "general" ? "General" : p.name}
            </button>
          ))}
        </div>

        {landing ? (
          /* ── Landing page ── */
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <div className="animate-rise m-auto w-full max-w-3xl px-4 py-10">
              <div className="mb-8 text-center">
                <h2 className="bg-linear-to-r from-(--persona) to-fuchsia-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
                  {greeting}.
                </h2>
                <p className="mt-2 text-xl text-fg-subtle sm:text-2xl">What are we building today?</p>
              </div>

              {composer}

              {options.length > 0 && (
                <div className="mt-10">
                  <p className="mb-2 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Jump back in</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {options.slice(0, 3).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setSlug(p)}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                          p === slug ? "border-(--persona)/40 bg-(--persona)/8" : "border-line bg-surface/60 hover:border-line-strong hover:bg-raised"
                        }`}
                      >
                        <FolderGit2 className="size-4 shrink-0 text-fg-subtle" />
                        <span className="truncate font-mono text-xs">{p}</span>
                        {p === slug && <Check className="ml-auto size-3.5 text-(--persona)" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
              }}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
                {messages.length === 0 && (
                  <div className="animate-rise flex flex-col items-center pt-[10vh] text-center">
                    <Avatar bot={bot} size="lg" />
                    <h2 className="mt-4 text-lg font-semibold tracking-tight">Work with {bot.name}</h2>
                    <p className="mt-1 max-w-md text-sm text-fg-muted">{bot.description}</p>
                    <div className="mt-6 grid w-full max-w-xl gap-2">
                      {bot.starters.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className="cursor-pointer rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm text-fg-muted transition hover:border-(--persona)/40 hover:text-fg hover:shadow-[0_0_24px_-12px_var(--persona)]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, mi) => {
                  const last = mi === messages.length - 1;
                  if (m.role === "user") {
                    return (
                      <div key={m.id} className="animate-rise flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-(--persona)/25 bg-(--persona)/10 px-4 py-2.5 text-sm whitespace-pre-wrap">
                          {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                        </div>
                      </div>
                    );
                  }
                  const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                  const streaming = status === "streaming" && last;
                  return (
                    <div key={m.id} className="group/msg animate-rise flex gap-3">
                      <Avatar bot={bot} size="sm" />
                      <div className={`min-w-0 flex-1 ${streaming ? "streaming-caret" : ""}`}>
                        {m.parts.map((part, i) => {
                          if (part.type === "text") return <Markdown key={i}>{part.text}</Markdown>;
                          if (part.type.startsWith("tool-")) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const t = part as any;
                            const name = toolName(t);
                            const done = t.state === "output-available";
                            // Hide finished read/list badges to keep the chat clean
                            if (done && (name === "readProjectFile" || name === "listProjectFiles")) return null;

                            let actionName = "Checking codebase";
                            if (name === "readProjectFile" && t.input?.filePath) actionName = `Reading ${t.input.filePath}`;
                            else if (name === "writeProjectFile" && t.input?.filePath) actionName = `Writing ${t.input.filePath}`;
                            else if (name === "listProjectFiles") actionName = "Listing directory";
                            else if (t.input?.fileName) actionName = `Updating ${t.input.fileName}`;

                            return (
                              <div key={i} className="my-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg-muted">
                                {done ? <Check className="size-3 text-emerald-400" /> : <Loader2 className="size-3 animate-spin" />}
                                {done ? `Completed: ${actionName}` : `Running: ${actionName}…`}
                              </div>
                            );
                          }
                          return null;
                        })}
                        {text && !streaming && (
                          <div className="mt-1 flex">
                            <CopyButton text={text} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {status === "submitted" && (
                  <div className="flex items-center gap-3" aria-label={`${bot.name} is thinking`}>
                    <Avatar bot={bot} size="sm" />
                    <div className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="size-1.5 animate-bounce rounded-full bg-(--persona)" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    <AlertTriangle className="size-4 shrink-0" />
                    Something went wrong (providers may be rate-limited).
                    <button onClick={() => regenerate()} className="ml-auto cursor-pointer underline">Retry</button>
                  </div>
                )}
              </div>
            </div>

            {!atBottom && (
              <button
                onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
                aria-label="Scroll to latest"
                className="animate-rise absolute bottom-28 left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-line-strong bg-raised p-2 text-fg-muted shadow-lg transition hover:text-fg"
              >
                <ArrowDown className="size-4" />
              </button>
            )}

            {composer}
          </>
        )}
      </main>

      {!landing && <CodePreviewPanel messages={messages} open={panelOpen} onClose={() => setPanelOpen(false)} projectSlug={effSlug} />}
    </div>
  );
}