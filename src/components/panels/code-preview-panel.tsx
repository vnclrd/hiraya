'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileCode, Loader2, X } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Tooltip } from '@/components/ui/tooltip';
import type { Artifact } from '@/lib/artifacts';

const contentKey = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
};

const GENERIC_NAME = /^snippet(\.|$)/i;
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/**
 * Code preview — a layer above the memory panel (same right edge, wider, higher z-index).
 * Slides in when code is generated; close it to get back to the memory panel.
 */
export function CodePreviewPanel({
  artifacts,
  open,
  onClose,
  onRequestOpen,
  projectSlug,
}: {
  artifacts: Artifact[];
  open: boolean;
  onClose: () => void;
  onRequestOpen: () => void;
  projectSlug: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null = newest
  const [pinned, setPinned] = useState<Artifact | null>(null); // opened from a chat card that isn't in `artifacts`
  const [copied, setCopied] = useState(false);
  const [displayed, setDisplayed] = useState('');
  const [typing, setTyping] = useState(false);

  // Tracks unique code content / artifact identifiers that have already finished animating
  const animated = useRef<Set<string>>(new Set());
  const ignoreOutside = useRef(false);

  // Close panel whenever user clicks outside of it
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ignoreOutside.current) return; // click came from a chat snippet card
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [open, onClose]);

  // New code arrives → follow the newest artifact
  useEffect(() => {
    setSelectedId(null);
    setPinned(null);
  }, [artifacts.length]);

  // "Preview" cards in the chat dispatch this event
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { code: string; lang: string; filename: string }
        | undefined;
      if (!d) return;
      ignoreOutside.current = true;
      setTimeout(() => {
        ignoreOutside.current = false;
      }, 0);
      const norm = (c: string) => c.replace(/\r\n/g, '\n').trim();
      const match = artifacts.find((a) => norm(a.code) === norm(d.code));
      if (match) {
        setSelectedId(match.id);
        setPinned(null);
      } else
        setPinned({
          id: `pinned:${d.filename}`,
          filename: d.filename,
          lang: d.lang || 'text',
          code: d.code,
          kind: 'snippet',
        });
      onRequestOpen();
    };
    window.addEventListener('hiraya-inspect-code', h);
    return () => window.removeEventListener('hiraya-inspect-code', h);
  }, [artifacts, onRequestOpen]);

  const tabs = pinned ? [...artifacts, pinned] : artifacts;
  const active =
    pinned ??
    artifacts.find((a) => a.id === selectedId) ??
    artifacts[artifacts.length - 1];
  const code = active?.code ?? '';
  const activeId = active?.id;

  // Typewriter reveal, running exactly ONCE per unique file/artifact content
  const animKey = contentKey(code);
  const alreadyAnimated = animated.current.has(animKey);

  useEffect(() => {
    if (!code || !open) return; // only animate while the panel is actually visible

    const key = contentKey(code);
    if (animated.current.has(key)) {
      setDisplayed(code);
      setTyping(false);
      return;
    }

    const step = Math.max(20, Math.ceil(code.length / 120));
    let i = 0;
    setTyping(true);
    setDisplayed('');

    const t = setInterval(() => {
      i += step;
      if (i >= code.length) {
        setDisplayed(code);
        setTyping(false);
        animated.current.add(key);
        clearInterval(t);
      } else {
        setDisplayed(code.slice(0, i));
      }
    }, 15);

    return () => clearInterval(t);
  }, [code, open]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  let snippetN = 0;
  return (
    <aside
      ref={panelRef}
      aria-hidden={!open}
      inert={!open}
      className={`fixed inset-y-0 right-0 z-40 flex w-[min(46rem,100vw)] flex-col border-l border-line-strong bg-surface shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.7)] transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className='flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-raised/50 px-4'>
        <span className='flex min-w-0 items-center gap-2 truncate font-mono text-xs font-semibold tracking-wider text-fg-muted uppercase'>
          <FileCode className='size-4 shrink-0 text-(--persona)' />
          <span className='truncate'>Code preview · {projectSlug}</span>
          {typing && (
            <Loader2 className='size-3 shrink-0 animate-spin text-(--persona)' />
          )}
        </span>
        <div className='flex shrink-0 items-center gap-1'>
          <Tooltip label='Copy code' side='bottom'>
            <button
              type='button'
              onClick={copy}
              aria-label='Copy code'
              className='flex cursor-pointer items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-fg-muted transition hover:bg-raised hover:text-fg'
            >
              {copied ? (
                <Check className='size-3 text-emerald-400' />
              ) : (
                <Copy className='size-3' />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </Tooltip>
          <Tooltip
            label='Hide — back to project memory'
            hint='⌘.'
            side='bottom'
          >
            <button
              type='button'
              onClick={onClose}
              aria-label='Hide code preview'
              className='cursor-pointer rounded-md p-1.5 text-fg-muted transition hover:bg-raised hover:text-fg'
            >
              <X className='size-4' />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* File tabs — one per generated artifact */}
      <div
        role='tablist'
        className='flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 pt-2'
      >
        {tabs.map((a) => {
          const label = GENERIC_NAME.test(a.filename)
            ? `snippet ${++snippetN}`
            : baseName(a.path ?? a.filename);
          const on = a.id === activeId;
          return (
            <button
              key={a.id}
              role='tab'
              aria-selected={on}
              title={a.path ?? a.filename}
              onClick={() => {
                setSelectedId(a.id);
                if (!a.id.startsWith('pinned')) setPinned(null);
              }}
              className={`relative shrink-0 cursor-pointer rounded-t-md px-3 py-2 font-mono text-xs whitespace-nowrap transition ${
                on ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {label}
              {on && (
                <span className='absolute inset-x-2 -bottom-px h-px bg-(--persona)' />
              )}
            </button>
          );
        })}
      </div>

      <div className='flex shrink-0 items-center justify-between border-b border-line px-4 py-2 font-mono text-[11px] whitespace-nowrap text-fg-subtle'>
        <span className='truncate'>
          {active?.path ?? active?.filename ?? '—'}
        </span>
        <span className='uppercase'>{active?.lang}</span>
      </div>

      <div className='min-h-0 flex-1 overflow-auto bg-canvas p-4'>
        <div className='overflow-hidden rounded-xl border border-line bg-surface shadow-md'>
          <style jsx global>{`
            .code-preview-highlighter pre {
              background: transparent !important;
            }
            .code-preview-highlighter span.linenumber {
              display: inline-block;
              min-width: 2.2rem;
              padding-right: 1rem;
              margin-right: 1rem;
              text-align: right;
              color: var(--color-fg-subtle, #6b7280);
              border-right: 1px solid
                var(--color-line, rgba(255, 255, 255, 0.08));
              user-select: none;
            }
          `}</style>
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={active?.lang || 'text'}
            PreTag='div'
            showLineNumbers
            wrapLines
            className='code-preview-highlighter'
            customStyle={{
              margin: 0,
              padding: '1.2rem',
              background: 'transparent',
              fontSize: '12.5px',
              lineHeight: '1.6',
            }}
            codeTagProps={{ style: { background: 'transparent' } }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({} as any)}
          >
            {alreadyAnimated ? code : displayed}
          </SyntaxHighlighter>
        </div>
      </div>
    </aside>
  );
}
