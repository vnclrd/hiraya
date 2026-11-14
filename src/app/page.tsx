"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AlertTriangle, ArrowDown, ArrowUp, BookMarked, Check, FileText, FolderGit2, Loader2, Square } from "lucide-react";
import { HIRAYA_PERSONAS, type PersonaConfig } from "@/config/personas";
import { Markdown } from "./components/markdown";
import { MemoryPanel, useProjectMemory } from "./components/memory-panel";
import { Tooltip } from "./components/tooltip";

const PERSONAS = Object.values(HIRAYA_PERSONAS);
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, ""); // mirrors server-side slug cleaning
const accent = (c: string) => ({ "--persona": c }) as React.CSSProperties;

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

export default function HirayaPage() {
  const [personaId, setPersonaId] = useState("violet");
  const [slug, setSlug] = useState("sample-project");
  const [draftSlug, setDraftSlug] = useState("sample-project");
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [wrapping, setWrapping] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const bot = HIRAYA_PERSONAS[personaId] ?? HIRAYA_PERSONAS.violet;
  const mem = useProjectMemory(slug);

  // One conversation per project + persona, so switching personas never mixes threads.
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
  const key = `${slug}:${personaId}`;
  let chat = threads.get(key);
  if (!chat) {
    chat = new Chat<UIMessage>({ id: key, transport, onFinish: () => refreshRef.current() });
    threads.set(key, chat);
  }
  const { messages, setMessages, sendMessage, status, error, stop, regenerate } = useChat({ chat });
  const busy = status === "submitted" || status === "streaming";

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3000);
  };

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    if (text.trim().toLowerCase() === "/wrap") return void wrap(true);
    sendMessage({ text }, { body: { personaId, projectSlug: slug } });
  };

  const wrap = async (clear: boolean) => {
    if (messages.length === 0 || wrapping) return;
    setWrapping(true);
    try {
      const res = await fetch("/api/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, projectSlug: slug, personaName: bot.name }),
      });
      if (!res.ok) throw new Error();
      await mem.refresh();
      if (clear) setMessages([]);
      flash("Session wrapped into PROGRESS.md");
    } catch {
      flash("Couldn't wrap session — try again", false);
    } finally {
      setWrapping(false);
    }
  };

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

  // Shortcuts: Alt+1..6 switch persona, Ctrl/Cmd+/ toggles memory panel
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey && /^Digit[1-6]$/.test(e.code)) setPersonaId(PERSONAS[Number(e.code.slice(5)) - 1].id);
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setPanelOpen((o) => !o); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const commitSlug = () => {
    const next = sanitize(draftSlug) || "sample-project";
    setDraftSlug(next);
    setSlug(next);
  };

  return (
    <div style={accent(bot.accent)} className="flex h-dvh bg-canvas text-fg">
      {/* ── Persona switcher ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="size-2.5 rounded-full bg-(--persona) shadow-[0_0_12px_var(--persona)]" />
          <h1 className="text-sm font-semibold tracking-tight">Hiraya</h1>
          <span className="text-xs text-fg-subtle">workspace</span>
        </div>
        <nav aria-label="Personas" className="flex-1 space-y-1 overflow-y-auto p-2">
          {PERSONAS.map((p, i) => {
            const active = p.id === personaId;
            return (
              <button
                key={p.id}
                type="button"
                style={{ "--p": p.accent } as React.CSSProperties}
                onClick={() => setPersonaId(p.id)}
                aria-current={active}
                className={`group flex w-full cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-left transition duration-200 ${
                  active
                    ? "border-(--p)/40 bg-(--p)/8 shadow-[0_0_28px_-12px_var(--p)]"
                    : "border-transparent hover:border-line hover:bg-raised"
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

      {/* ── Chat ── */}
      <main className="ambient relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur">
          <Avatar bot={bot} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">{bot.name}</div>
            <div className="hidden truncate text-[11px] text-fg-muted sm:block">{bot.title}</div>
          </div>

          <Tooltip label="Active folder inside workspace-projects/" side="bottom">
            <label className="ml-2 flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg-muted focus-within:border-(--persona)/60">
              <FolderGit2 className="size-3.5" />
              <input
                value={draftSlug}
                onChange={(e) => setDraftSlug(sanitize(e.target.value))}
                onBlur={commitSlug}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                aria-label="Project folder"
                className="w-28 bg-transparent font-mono text-fg outline-hidden sm:w-36"
              />
            </label>
          </Tooltip>

          <div className="ml-auto flex items-center gap-2">
            {notice && (
              <span className={`animate-rise hidden items-center gap-1 text-xs sm:flex ${notice.ok ? "text-emerald-400" : "text-red-400"}`}>
                {notice.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />} {notice.text}
              </span>
            )}
            {modelUsed && (
              <span className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle lg:inline" title="Model that served the last reply">
                {modelUsed}
              </span>
            )}
            <Tooltip label="Project memory" hint="⌘/" side="bottom">
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                aria-label="Open project memory"
                className="cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg xl:hidden"
              >
                <FileText className="size-4" />
              </button>
            </Tooltip>
            <Tooltip label="Summarize this chat into PROGRESS.md and start fresh" hint="/wrap" side="bottom">
              <button
                type="button"
                onClick={() => wrap(true)}
                disabled={wrapping || messages.length === 0}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {wrapping ? <Loader2 className="size-3.5 animate-spin" /> : <BookMarked className="size-3.5" />}
                {wrapping ? "Wrapping…" : "Wrap session"}
              </button>
            </Tooltip>
          </div>
        </header>

        {/* Mobile persona strip */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-line p-2 md:hidden">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPersonaId(p.id)}
              style={{ "--p": p.accent } as React.CSSProperties}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
                p.id === personaId ? "border-(--p)/50 bg-(--p)/10 text-fg" : "border-line text-fg-muted"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

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
              return (
                <div key={m.id} className="animate-rise flex gap-3">
                  <Avatar bot={bot} size="sm" />
                  <div className={`min-w-0 flex-1 ${status === "streaming" && last ? "streaming-caret" : ""}`}>
                    {m.parts.map((part, i) => {
                      if (part.type === "text") return <Markdown key={i}>{part.text}</Markdown>;
                      if (part.type.startsWith("tool-")) {
                        const t = part as { state?: string; input?: { fileName?: string } };
                        const done = t.state === "output-available";
                        return (
                          <div key={i} className="my-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg-muted">
                            {done ? <Check className="size-3 text-emerald-400" /> : <Loader2 className="size-3 animate-spin" />}
                            {done ? "Updated" : "Updating"} {t.input?.fileName ?? "project memory"}
                          </div>
                        );
                      }
                      return null;
                    })}
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

        {/* Composer */}
        <form onSubmit={submit} className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          <div className="rounded-xl border border-line-strong bg-surface shadow-lg transition focus-within:border-(--persona)/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--persona)_14%,transparent)]">
            <textarea
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={`Ask ${bot.name} about ${slug}…`}
              aria-label="Message"
              className="block max-h-52 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-hidden placeholder:text-fg-subtle"
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <span className="text-[11px] text-fg-subtle">
                <kbd className="font-mono">Enter</kbd> send · <kbd className="font-mono">Shift+Enter</kbd> newline · <kbd className="font-mono">/wrap</kbd> end session
              </span>
              {busy ? (
                <Tooltip label="Stop generating" side="top">
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
      </main>

      <MemoryPanel mem={mem} open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}