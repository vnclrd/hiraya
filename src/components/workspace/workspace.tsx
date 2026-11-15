'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookMarked,
  Check,
  FileCode,
  FileText,
  FolderGit2,
  Loader2,
  PanelLeft,
  Plus,
  Square,
} from 'lucide-react';
import { HIRAYA_PERSONAS } from '@/config/personas';
import { GENERAL, PERSONAS } from '@/config/modes';
import { accent } from '@/lib/accent';
import { sanitize } from '@/lib/slug';
import { loadThread, saveThread, dropThread } from '@/lib/thread-storage';
import { finishedWriteIds, toolName } from '@/lib/tool-parts';
import { extractArtifacts } from '@/lib/artifacts';
import { useProjectMemory } from '@/hooks/use-project-memory';
import { useProjects } from '@/hooks/use-projects';
import { Markdown } from '@/components/ui/markdown';
import { Tooltip } from '@/components/ui/tooltip';
import { Avatar } from '@/components/ui/avatar';
import { CopyButton } from '@/components/ui/copy-button';
import { ProjectSelect } from '@/components/project/project-select';
import { Sidebar } from '@/components/layout/sidebar';
import { MemoryPanel } from '@/components/panels/memory-panel';
import { CodePreviewPanel } from '@/components/panels/code-preview-panel';

export function Workspace() {
  const [view, setView] = useState<string>('general'); // "general" or a persona id — General is the landing view
  const [slug, setSlug] = useState('sample-project'); // "" = no project (scratch space)
  const [greeting, setGreeting] = useState('Welcome back');
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memOpen, setMemOpen] = useState(false); // memory slide-over (below xl; docked at xl+)
  const [codeOpen, setCodeOpen] = useState(false); // code preview layer above the memory panel

  // Auto-hide sidebar on small screens (< 768px)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [wrapping, setWrapping] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handledWrites = useRef<Set<string>>(new Set());
  const lastWrapped = useRef<Map<string, number>>(new Map());
  const pendingSend = useRef<{ text: string; slug: string } | null>(null);
  const routing = useRef(false);

  const isGeneral = view === 'general';
  const bot = isGeneral ? GENERAL : (HIRAYA_PERSONAS[view] ?? GENERAL);
  const effSlug = slug || 'general'; // "general" is the scratch folder on disk
  const mem = useProjectMemory(effSlug);
  const {
    projects,
    loading: projectsLoading,
    reload: loadProjects,
  } = useProjects();

  // Boot: restore last project, resume view after an auto-reload, time-based greeting, project list
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hiraya:project');
      if (saved !== null) setSlug(sanitize(saved));
      const resume = sessionStorage.getItem('hiraya:resume');
      if (resume) {
        sessionStorage.removeItem('hiraya:resume');
        setView(resume);
      }
      handledWrites.current = new Set(
        JSON.parse(sessionStorage.getItem('hiraya:writes') ?? '[]'),
      );
    } catch {}
    const h = new Date().getHours();
    setGreeting(
      h < 5
        ? 'Working late'
        : h < 12
          ? 'Good morning'
          : h < 18
            ? 'Good afternoon'
            : 'Good evening',
    );
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('hiraya:project', slug);
    } catch {}
  }, [slug]);

  // One conversation per project + mode, so switching personas never mixes threads.
  const refreshRef = useRef(mem.refresh);
  useEffect(() => {
    refreshRef.current = mem.refresh;
  });
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          setModelUsed(res.headers.get('X-Model-Used'));
          return res;
        },
      }),
    [],
  );
  const [threads] = useState(() => new Map<string, Chat<UIMessage>>());
  const key = `${effSlug}:${bot.id}`;
  let chat = threads.get(key);
  if (!chat) {
    chat = new Chat<UIMessage>({
      id: key,
      transport,
      onFinish: () => refreshRef.current(),
    });
    threads.set(key, chat);
  }
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    stop,
    regenerate,
  } = useChat({ chat });
  const busy = status === 'submitted' || status === 'streaming';
  const landing = isGeneral && messages.length === 0;
  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);

  // Code preview: slide it in when new code is generated during a reply; hide when switching threads
  const seenArtifacts = useRef(0);
  useEffect(() => {
    if (artifacts.length > seenArtifacts.current && busy) setCodeOpen(true);
    seenArtifacts.current = artifacts.length;
  }, [artifacts.length, busy]);
  useEffect(() => {
    setCodeOpen(false);
  }, [key]);
  const canWrap = !!slug && messages.length > 0;

  // Restore a saved thread when its (project, mode) is opened; never trigger the reload hook for old writes
  useEffect(() => {
    const stored = loadThread(key);
    if (!stored?.length) return;
    finishedWriteIds(stored).forEach((id) => handledWrites.current.add(id));
    setMessages((prev) => (prev.length ? prev : stored));
  }, [key, setMessages]);
  useEffect(() => {
    if (messages.length && !busy) saveThread(key, messages);
  }, [messages, busy, key]);

  // After an auto-switch, send the held prompt once the new project's thread is mounted and restored
  useEffect(() => {
    const p = pendingSend.current;
    if (!p || p.slug !== effSlug) return;
    pendingSend.current = null;
    sendMessage(
      { text: p.text },
      { body: { personaId: bot.id, projectSlug: effSlug } },
    );
  }, [effSlug, bot.id, sendMessage]);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3000);
  };

  const send = async (text: string) => {
    if (!text.trim() || busy || routing.current) return;
    if (text.trim().toLowerCase() === '/wrap') return void wrap(true);

    // Does this prompt name another project, or ask for a file that lives in one? If so, switch first.
    routing.current = true;
    try {
      const res = await fetch('/api/projects/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, current: effSlug }),
      });
      if (!res.ok) throw new Error(`resolve returned ${res.status}`);
      const { switchTo, files } = await res.json();
      const target = switchTo ? sanitize(switchTo) : '';
      if (target && target !== effSlug) {
        pendingSend.current = { text, slug: target };
        setSlug(target);
        flash(
          `Switched to ${target}${files?.[0] ? ` — ${files[0]} lives there` : ''}`,
        );
        return;
      }
    } catch (err) {
      console.warn('[Hiraya] project routing skipped:', err); // best-effort: send in the current project
    } finally {
      routing.current = false;
    }
    sendMessage(
      { text },
      { body: { personaId: bot.id, projectSlug: effSlug } },
    );
  };

  const wrap = async (clear = false) => {
    if (messages.length === 0 || wrapping) return;
    if (!slug)
      return flash('Pick a project first to wrap into its PROGRESS.md', false);
    setWrapping(true);
    try {
      const res = await fetch('/api/closeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          projectSlug: slug,
          personaName: bot.name,
        }),
      });
      if (!res.ok) throw new Error();
      lastWrapped.current.set(key, messages.length);
      await mem.refresh();
      loadProjects();
      if (clear) {
        setMessages([]);
        dropThread(key);
        lastWrapped.current.delete(key);
      }
      flash('Session wrapped into PROGRESS.md & transcript saved');
    } catch {
      flash("Couldn't wrap session — try again", false);
    } finally {
      setWrapping(false);
    }
  };

  const newChat = () => {
    setMessages([]);
    dropThread(key);
    setInput('');
    composerRef.current?.focus();
  };

  // ── IDLE AUTO-WRAP (30 min) — only once per unchanged conversation (fixes repeat-wrap loop) ──
  useEffect(() => {
    if (
      !canWrap ||
      wrapping ||
      busy ||
      lastWrapped.current.get(key) === messages.length
    )
      return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => wrap(false), 30 * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
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
    const fresh = finishedWriteIds(messages).filter(
      (id) => !handledWrites.current.has(id),
    );
    if (!fresh.length) return;
    fresh.forEach((id) => handledWrites.current.add(id));
    try {
      sessionStorage.setItem(
        'hiraya:writes',
        JSON.stringify([...handledWrites.current]),
      );
      sessionStorage.setItem('hiraya:resume', view);
    } catch {}
    saveThread(key, messages);
    const t = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(t);
  }, [messages, view, key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
    setInput('');
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
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, landing]);
  useEffect(() => {
    composerRef.current?.focus();
  }, [view, landing]);

  // Shortcuts: Alt+0 General, Alt+1..6 personas, Ctrl/Cmd+/ memory, Ctrl/Cmd+. code preview, "/" focus composer, Esc stop
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(
        (e.target as HTMLElement)?.tagName ?? '',
      );
      if (e.altKey && /^Digit[0-6]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        setView(n === 0 ? 'general' : (PERSONAS[n - 1]?.id ?? 'general'));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setMemOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setCodeOpen((o) => !o);
      }
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        composerRef.current?.focus();
      }
      if (e.key === 'Escape' && busy) stop();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [busy, stop]);

  const options =
    slug && !projects.includes(slug) ? [slug, ...projects] : projects;

  const composer = (
    <form
      onSubmit={submit}
      className={
        landing ? 'w-full' : 'mx-auto w-full max-w-3xl shrink-0 px-4 pb-4'
      }
    >
      <div
        className={`flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 transition focus-within:border-(--persona)/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--persona)_14%,transparent)] ${
          landing ? 'shadow-2xl' : 'shadow-lg'
        }`}
      >
        <textarea
          ref={composerRef}
          value={input}
          rows={landing ? 2 : 1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            landing
              ? 'Ask anything, or pick a persona below…'
              : `Ask ${bot.name} about ${slug || 'anything'}…`
          }
          aria-label='Message'
          className={`block max-h-10 w-full resize-none bg-transparent px-3 py-2 outline-hidden placeholder:text-fg-subtle ${landing ? 'text-base' : 'text-sm'}`}
        />
        <div className='flex shrink-0 pb-0.5 pr-0.5'>
          {busy ? (
            <Tooltip label='Stop generating' hint='Esc' side='top'>
              <button
                type='button'
                onClick={() => stop()}
                aria-label='Stop'
                className='grid size-8 cursor-pointer place-items-center rounded-xl border border-line-strong text-fg transition hover:bg-raised'
              >
                <Square className='size-3.5 fill-current' />
              </button>
            </Tooltip>
          ) : (
            <button
              type='submit'
              disabled={!input.trim()}
              aria-label='Send'
              className='grid size-8 cursor-pointer place-items-center rounded-xl bg-(--persona) text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30'
            >
              <ArrowUp className='size-4' />
            </button>
          )}
        </div>
      </div>
    </form>
  );

  return (
    <div style={accent(bot.accent)} className='flex h-dvh overflow-hidden bg-canvas text-fg'>
      <div
        className={`flex shrink-0 transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'w-64 translate-x-0 opacity-100' : 'w-0 -translate-x-full opacity-0 overflow-hidden'
        }`}
      >
        <Sidebar view={view} onSelect={setView} />
      </div>

      {/* ── Main ── */}
      <main className='ambient relative flex min-w-0 flex-1 flex-col'>
        {/* Header: identity | centered project dropdown | actions */}
        <header className='grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur'>
          <div className='flex min-w-0 items-center gap-3'>
            <Tooltip
              label={sidebarOpen ? 'Hide personas sidebar' : 'Show personas sidebar'}
              side='bottom'
            >
              <button
                type='button'
                onClick={() => setSidebarOpen((o) => !o)}
                aria-label='Toggle sidebar'
                className='cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg'
              >
                <PanelLeft className='size-4' />
              </button>
            </Tooltip>
            <Avatar bot={bot} />
            <div className='hidden min-w-0 leading-tight sm:block'>
              <div className='truncate text-sm font-semibold'>
                {isGeneral ? 'General chat' : bot.name}
              </div>
              <div className='truncate text-[11px] text-fg-muted'>
                {isGeneral ? 'Ask anything' : bot.title}
              </div>
            </div>
          </div>

          <ProjectSelect
            value={slug}
            projects={options}
            loading={projectsLoading}
            onChange={setSlug}
          />

          <div className='flex items-center justify-end gap-2'>
            {notice && (
              <span
                className={`animate-rise hidden items-center gap-1 text-xs xl:flex ${notice.ok ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {notice.ok ? (
                  <Check className='size-3.5' />
                ) : (
                  <AlertTriangle className='size-3.5' />
                )}{' '}
                {notice.text}
              </span>
            )}
            {modelUsed && (
              <span
                className='hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle xl:inline'
                title='Model that served the last reply'
              >
                {modelUsed}
              </span>
            )}
            {isGeneral && messages.length > 0 && (
              <Tooltip label='Start a new chat' side='bottom'>
                <button
                  type='button'
                  onClick={newChat}
                  aria-label='New chat'
                  className='cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg'
                >
                  <Plus className='size-4' />
                </button>
              </Tooltip>
            )}
            {!landing && (
              <>
                <Tooltip label='Project memory' hint='⌘/' side='bottom'>
                  <button
                    type='button'
                    onClick={() => setMemOpen((o) => !o)}
                    aria-label='Toggle project memory'
                    className='cursor-pointer rounded-md border border-line p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg xl:hidden'
                  >
                    <FileText className='size-4' />
                  </button>
                </Tooltip>
                {artifacts.length > 0 && (
                  <Tooltip
                    label={codeOpen ? 'Hide code preview' : 'Show code preview'}
                    hint='⌘.'
                    side='bottom'
                  >
                    <button
                      type='button'
                      onClick={() => setCodeOpen((o) => !o)}
                      aria-label='Toggle code preview'
                      data-keep-code-open
                      aria-pressed={codeOpen}
                      className={`relative cursor-pointer rounded-md border p-1.5 transition ${
                        codeOpen
                          ? 'border-(--persona)/50 bg-(--persona)/10 text-(--persona)'
                          : 'border-line text-fg-muted hover:bg-raised hover:text-fg'
                      }`}
                    >
                      <FileCode className='size-4' />
                      <span className='absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full bg-(--persona) px-1 text-[9px] font-semibold text-canvas'>
                        {artifacts.length}
                      </span>
                    </button>
                  </Tooltip>
                )}
                <Tooltip
                  label={
                    slug
                      ? 'Summarize this chat into PROGRESS.md and start fresh'
                      : 'Pick a project to wrap this session'
                  }
                  hint='/wrap'
                  side='bottom'
                >
                  <button
                    type='button'
                    onClick={() => wrap(true)}
                    disabled={wrapping || !canWrap}
                    aria-label='Wrap session'
                    className='flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    {wrapping ? (
                      <Loader2 className='size-3.5 animate-spin' />
                    ) : (
                      <BookMarked className='size-3.5' />
                    )}
                    <span className='hidden lg:inline'>
                      {wrapping ? 'Wrapping…' : 'Wrap session'}
                    </span>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </header>

        {/* Mobile mode strip */}
        <div className='flex gap-1.5 overflow-x-auto border-b border-line p-2 md:hidden'>
          {[GENERAL, ...PERSONAS].map((p) => (
            <button
              key={p.id}
              onClick={() => setView(p.id)}
              style={{ '--p': p.accent } as React.CSSProperties}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
                p.id === bot.id
                  ? 'border-(--p)/50 bg-(--p)/10 text-fg'
                  : 'border-line text-fg-muted'
              }`}
            >
              {p.id === 'general' ? 'General' : p.name}
            </button>
          ))}
        </div>

        {landing ? (
          /* ── Landing page ── */
          <div className='flex min-h-0 flex-1 overflow-y-auto'>
            <div className='animate-rise m-auto w-full max-w-3xl px-4 py-10'>
              <div className='mb-8 text-center'>
                <h2 className='bg-linear-to-r from-(--persona) to-fuchsia-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl'>
                  {greeting}.
                </h2>
                <p className='mt-2 text-xl text-fg-subtle sm:text-2xl'>
                  What are we building today?
                </p>
              </div>

              {composer}

              {options.length > 0 && (
                <div className='mt-10'>
                  <p className='mb-2 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase'>
                    Jump back in
                  </p>
                  <div className='grid gap-2 sm:grid-cols-3'>
                    {options.slice(0, 3).map((p) => (
                      <button
                        key={p}
                        type='button'
                        onClick={() => setSlug(p)}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                          p === slug
                            ? 'border-(--persona)/40 bg-(--persona)/8'
                            : 'border-line bg-surface/60 hover:border-line-strong hover:bg-raised'
                        }`}
                      >
                        <FolderGit2 className='size-4 shrink-0 text-fg-subtle' />
                        <span className='truncate font-mono text-xs'>{p}</span>
                        {p === slug && (
                          <Check className='ml-auto size-3.5 text-(--persona)' />
                        )}
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
                setAtBottom(
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80,
                );
              }}
              className='min-h-0 flex-1 overflow-y-auto'
            >
              <div className='mx-auto w-full max-w-3xl space-y-6 px-4 py-6'>
                {messages.length === 0 && (
                  <div className='animate-rise flex flex-col items-center pt-[10vh] text-center'>
                    <Avatar bot={bot} size='lg' />
                    <h2 className='mt-4 text-lg font-semibold tracking-tight'>
                      Work with {bot.name}
                    </h2>
                    <p className='mt-1 max-w-md text-sm text-fg-muted'>
                      {bot.description}
                    </p>
                    <div className='mt-6 grid w-full max-w-xl gap-2'>
                      {bot.starters.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className='cursor-pointer rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm text-fg-muted transition hover:border-(--persona)/40 hover:text-fg hover:shadow-[0_0_24px_-12px_var(--persona)]'
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, mi) => {
                  const last = mi === messages.length - 1;
                  if (m.role === 'user') {
                    return (
                      <div key={m.id} className='animate-rise flex justify-end'>
                        <div className='max-w-[85%] rounded-2xl rounded-br-md border border-(--persona)/25 bg-(--persona)/10 px-4 py-2.5 text-sm whitespace-pre-wrap'>
                          {m.parts
                            .map((p) => (p.type === 'text' ? p.text : ''))
                            .join('')}
                        </div>
                      </div>
                    );
                  }
                  const text = m.parts
                    .map((p) => (p.type === 'text' ? p.text : ''))
                    .join('');
                  const streaming = status === 'streaming' && last;
                  return (
                    <div
                      key={m.id}
                      className='group/msg animate-rise flex gap-3'
                    >
                      <Avatar bot={bot} size='sm' />
                      <div
                        className={`min-w-0 flex-1 ${streaming ? 'streaming-caret' : ''}`}
                      >
                        {m.parts.map((part, i) => {
                          if (part.type === 'text')
                            return <Markdown key={i}>{part.text}</Markdown>;
                          if (part.type.startsWith('tool-')) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const t = part as any;
                            const name = toolName(t);
                            const done = t.state === 'output-available';
                            // Hide finished read/list badges to keep the chat clean
                            if (
                              done &&
                              (name === 'readProjectFile' ||
                                name === 'listProjectFiles')
                            )
                              return null;

                            let actionName = 'Checking codebase';
                            if (name === 'readProjectFile' && t.input?.filePath)
                              actionName = `Reading ${t.input.filePath}`;
                            else if (
                              name === 'writeProjectFile' &&
                              t.input?.filePath
                            )
                              actionName = `Writing ${t.input.filePath}`;
                            else if (name === 'listProjectFiles')
                              actionName = 'Listing directory';
                            else if (t.input?.fileName)
                              actionName = `Updating ${t.input.fileName}`;

                            return (
                              <div
                                key={i}
                                className='my-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg-muted'
                              >
                                {done ? (
                                  <Check className='size-3 text-emerald-400' />
                                ) : (
                                  <Loader2 className='size-3 animate-spin' />
                                )}
                                {done
                                  ? `Completed: ${actionName}`
                                  : `Running: ${actionName}…`}
                              </div>
                            );
                          }
                          return null;
                        })}
                        {text && !streaming && (
                          <div className='mt-1 flex'>
                            <CopyButton text={text} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {status === 'submitted' && (
                  <div
                    className='flex items-center gap-3'
                    aria-label={`${bot.name} is thinking`}
                  >
                    <Avatar bot={bot} size='sm' />
                    <div className='flex gap-1'>
                      {[0, 150, 300].map((d) => (
                        <span
                          key={d}
                          className='size-1.5 animate-bounce rounded-full bg-(--persona)'
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className='flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300'>
                    <AlertTriangle className='size-4 shrink-0' />
                    Something went wrong (providers may be rate-limited).
                    <button
                      onClick={() => regenerate()}
                      className='ml-auto cursor-pointer underline'
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>

            {!atBottom && (
              <button
                onClick={() =>
                  scroller.current?.scrollTo({
                    top: scroller.current.scrollHeight,
                    behavior: 'smooth',
                  })
                }
                aria-label='Scroll to latest'
                className='animate-rise absolute bottom-28 left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-line-strong bg-raised p-2 text-fg-muted shadow-lg transition hover:text-fg'
              >
                <ArrowDown className='size-4' />
              </button>
            )}

            {composer}
          </>
        )}
      </main>

      {!landing && (
        <>
          <MemoryPanel
            mem={mem}
            open={memOpen}
            onClose={() => setMemOpen(false)}
          />
          <CodePreviewPanel
            artifacts={artifacts}
            open={codeOpen && artifacts.length > 0}
            onClose={() => setCodeOpen(false)}
            onRequestOpen={() => {
              if (!codeOpen) setCodeOpen(true);
            }}
            projectSlug={effSlug}
          />
        </>
      )}
    </div>
  );
}
