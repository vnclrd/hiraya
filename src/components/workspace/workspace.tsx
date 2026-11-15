'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { HIRAYA_PERSONAS } from '@/config/personas';
import { GENERAL } from '@/config/modes';
import { accent } from '@/lib/accent';
import { sanitize } from '@/lib/slug';
import { loadThread, saveThread, dropThread } from '@/lib/thread-storage';
import { finishedWriteIds } from '@/lib/tool-parts';
import { extractArtifacts } from '@/lib/artifacts';
import { useProjectMemory } from '@/hooks/use-project-memory';
import { useProjects } from '@/hooks/use-projects';
import { useUserName } from '@/hooks/use-user-name';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { Sidebar } from '@/components/layout/sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { PersonaStrip } from '@/components/layout/persona-strip';
import { Composer } from '@/components/chat/composer';
import { ChatThread } from '@/components/chat/chat-thread';
import { Landing } from '@/components/chat/landing';
import { MemoryPanel } from '@/components/panels/memory-panel';
import { CodePreviewPanel } from '@/components/panels/code-preview-panel';

const IDLE_WRAP_MS = 30 * 60 * 1000;

/** App shell: owns chat threads, project routing and wrap/reload logic; presentation lives in child components. */
export function Workspace() {
  const [view, setView] = useState<string>('general');
  const [slug, setSlug] = useState('');
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memOpen, setMemOpen] = useState(false); // memory slide-over (below xl; docked at xl+)
  const [codeOpen, setCodeOpen] = useState(false); // code preview layer above the memory panel
  const [wrapping, setWrapping] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);

  const name = useUserName();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handledWrites = useRef<Set<string>>(new Set());
  const lastWrapped = useRef<Map<string, number>>(new Map());
  const pendingSend = useRef<{ text: string; slug: string } | null>(null);
  const routing = useRef(false);

  const isGeneral = view === 'general';
  const bot = isGeneral ? GENERAL : (HIRAYA_PERSONAS[view] ?? GENERAL);
  const effSlug = slug || 'general';
  const mem = useProjectMemory(effSlug);
  const { projects, loading: projectsLoading, reload: loadProjects } = useProjects();

  // Boot: restore last project, resume view after an auto-reload, and the writes already handled
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
  const { messages, setMessages, sendMessage, status, error, stop, regenerate } = useChat({ chat });
  const busy = status === 'submitted' || status === 'streaming';
  const landing = isGeneral && messages.length === 0;
  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);
  const canWrap = !!slug && messages.length > 0;

  // Code preview: slide it in when new code is generated during a reply; hide when switching threads
  const seenArtifacts = useRef(0);
  useEffect(() => {
    if (artifacts.length > seenArtifacts.current && busy) setCodeOpen(true);
    seenArtifacts.current = artifacts.length;
  }, [artifacts.length, busy]);
  useEffect(() => {
    setCodeOpen(false);
  }, [key]);

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
    sendMessage({ text: p.text }, { body: { personaId: bot.id, projectSlug: effSlug } });
  }, [effSlug, bot.id, sendMessage]);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3000);
  };

  const wrap = async (clear = false) => {
    if (messages.length === 0 || wrapping) return;
    if (!slug) return flash('Pick a project first to wrap into its PROGRESS.md', false);
    setWrapping(true);
    try {
      const res = await fetch('/api/closeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, projectSlug: slug, personaName: bot.name }),
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
        flash(`Switched to ${target}${files?.[0] ? ` — ${files[0]} lives there` : ''}`);
        return;
      }
    } catch (err) {
      console.warn('[Hiraya] project routing skipped:', err); // best-effort: send in the current project
    } finally {
      routing.current = false;
    }
    sendMessage({ text }, { body: { personaId: bot.id, projectSlug: effSlug } });
  };

  const newChat = () => {
    setMessages([]);
    dropThread(key);
    setInput('');
    composerRef.current?.focus();
  };

  const submit = () => {
    send(input);
    setInput('');
  };

  // Idle auto-wrap (30 min) — only once per unchanged conversation (prevents a repeat-wrap loop)
  useEffect(() => {
    if (!canWrap || wrapping || busy || lastWrapped.current.get(key) === messages.length) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => wrap(false), IDLE_WRAP_MS);
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

  // Reload after new file writes (each tool call handled once; threads + view survive the reload)
  useEffect(() => {
    const fresh = finishedWriteIds(messages).filter((id) => !handledWrites.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => handledWrites.current.add(id));
    try {
      sessionStorage.setItem('hiraya:writes', JSON.stringify([...handledWrites.current]));
      sessionStorage.setItem('hiraya:resume', view);
    } catch {}
    saveThread(key, messages);
    const t = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(t);
  }, [messages, view, key]);

  useEffect(() => {
    composerRef.current?.focus();
  }, [view, landing]);

  const toggleMemory = useCallback(() => setMemOpen((o) => !o), []);
  const toggleCode = useCallback(() => setCodeOpen((o) => !o), []);
  useShortcuts({ busy, stop, setView, toggleMemory, toggleCode, composerRef });

  const options = slug && !projects.includes(slug) ? [slug, ...projects] : projects;

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSubmit={submit}
      onStop={stop}
      busy={busy}
      landing={landing}
      inputRef={composerRef}
      placeholder={
        landing ? 'Ask anything, or pick a persona below…' : `Ask ${bot.name} about ${slug || 'anything'}…`
      }
    />
  );

  return (
    <div style={accent(bot.accent)} className='flex h-dvh overflow-hidden bg-canvas text-fg'>
      {/* Sidebar: fixed-width inside a collapsing wrapper, so content never squishes while animating */}
      <div
        inert={!sidebarOpen}
        className={`hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out md:block ${
          sidebarOpen ? 'w-64' : 'w-0'
        }`}
      >
        <Sidebar view={view} onSelect={setView} />
      </div>

      <main className='ambient relative flex min-w-0 flex-1 flex-col'>
        <AppHeader
          bot={bot}
          isGeneral={isGeneral}
          landing={landing}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          project={{ slug, options, loading: projectsLoading, onChange: setSlug }}
          notice={notice}
          modelUsed={modelUsed}
          showNewChat={isGeneral && messages.length > 0}
          onNewChat={newChat}
          onToggleMemory={toggleMemory}
          artifactCount={artifacts.length}
          codeOpen={codeOpen}
          onToggleCode={toggleCode}
          wrap={{ busy: wrapping, canWrap, hasProject: !!slug, onWrap: () => wrap(true) }}
        />

        <PersonaStrip activeId={bot.id} onSelect={setView} />

        {landing ? (
          <Landing
            greeting={name.greeting}
            editingName={name.editing}
            nameDraft={name.draft}
            onNameDraft={name.setDraft}
            onStartEditName={name.startEditing}
            onSaveName={name.save}
            composer={composer}
            projects={options}
            activeProject={slug}
            onPickProject={setSlug}
          />
        ) : (
          <>
            <ChatThread
              messages={messages}
              status={status}
              error={error}
              bot={bot}
              onSend={send}
              onRetry={() => regenerate()}
            />
            {composer}
          </>
        )}
      </main>

      {!landing && (
        <>
          <MemoryPanel mem={mem} open={memOpen} onClose={() => setMemOpen(false)} />
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
