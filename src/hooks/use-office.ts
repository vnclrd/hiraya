'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Chat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage } from 'ai';
import { HIRAYA_PERSONAS } from '@/config/personas';
import { loadThread, saveThread } from '@/lib/thread-storage';
import { finishedWriteIds, toolName } from '@/lib/tool-parts';

export type Activity = {
  state: 'working' | 'unread' | 'error';
  from?: string;
  task?: string;
};

type Task = { to: string; from: string; brief: string; files?: string[]; hop: number };

export const MAX_HOPS = 3;

type Options = {
  activeKey: string;
  transport: ChatTransport<UIMessage>;
  onSettled: () => void;
  handledWrites: RefObject<Set<string>>;
};

export function useOffice(opts: Options) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const chats = useRef(new Map<string, Chat<UIMessage>>());
  const queue = useRef(new Map<string, Task[]>());
  const seen = useRef(new Set<string>());

  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const activityRef = useRef(activity);
  useEffect(() => {
    activityRef.current = activity;
  });

  function mark(key: string, a: Activity | null) {
    setActivity((prev) => {
      if (a) return { ...prev, [key]: a };
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function getChat(slug: string, personaId: string) {
    const key = `${slug}:${personaId}`;
    let chat = chats.current.get(key);
    if (!chat) {
      chat = new Chat<UIMessage>({
        id: key,
        transport: optsRef.current.transport,
        onFinish: () => settle(key, slug, personaId),
        onError: () => mark(key, { state: 'error' }),
      });
      chats.current.set(key, chat);
    }
    return chat;
  }

  function dispatch(t: Task, slug: string) {
    const key = `${slug}:${t.to}`;
    const chat = getChat(slug, t.to);

    if (chat.status === 'submitted' || chat.status === 'streaming') {
      queue.current.set(key, [...(queue.current.get(key) ?? []), t]);
      return;
    }

    if (chat.messages.length === 0) {
      const stored = loadThread(key);
      if (stored?.length) chat.messages = stored;
    }

    mark(key, { state: 'working', from: t.from, task: t.brief });
    const fromName = HIRAYA_PERSONAS[t.from]?.name ?? t.from;
    
    // 3.5s Cooldown delay to prevent burst rate limits on background delegations
    setTimeout(() => {
      void chat.sendMessage(
        {
          text: `[Task from ${fromName}]\n${t.brief}${t.files?.length ? `\n\nFiles: ${t.files.join(', ')}` : ''}`,
          metadata: { from: t.from, hop: t.hop },
        },
        { body: { personaId: t.to, projectSlug: slug, hop: t.hop } },
      );
    }, 3500);
  }

  function settle(key: string, slug: string, personaId: string) {
    const chat = chats.current.get(key);
    if (!chat) return;
    const { activeKey, handledWrites, onSettled } = optsRef.current;
    const viewing = activeKey === key;

    saveThread(key, chat.messages);
    if (!viewing) finishedWriteIds(chat.messages).forEach((id) => handledWrites.current.add(id));
    onSettled();

    const prev = activityRef.current[key];
    mark(key, viewing ? null : { state: 'unread', from: prev?.from, task: prev?.task });

    const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user');
    const hop = (lastUser?.metadata as { hop?: number } | undefined)?.hop ?? 0;
    const last = chat.messages[chat.messages.length - 1];
    const tasks: Task[] = [];
    
    (last?.parts ?? []).forEach((p, i) => {
      const part = p as any;
      if (!part.type?.startsWith('tool-') || toolName(part) !== 'delegateTask') return;
      if (part.state !== 'output-available') return;
      const id = part.toolCallId ?? `${last.id}:${i}`;
      if (seen.current.has(id) || hop + 1 > MAX_HOPS) return;
      seen.current.add(id);
      tasks.push({
        to: part.input.to,
        from: personaId,
        brief: part.input.brief,
        files: part.input.files,
        hop: hop + 1,
      });
    });
    const next = queue.current.get(key)?.shift();

    setTimeout(() => {
      tasks.forEach((t) => dispatch(t, slug));
      if (next) dispatch(next, slug);
    }, 1000);
  }

  useEffect(() => {
    setActivity((prev) => {
      const a = prev[opts.activeKey];
      if (!a || a.state === 'working') return prev;
      const next = { ...prev };
      delete next[opts.activeKey];
      return next;
    });
  }, [opts.activeKey]);

  const anyWorking = useMemo(() => Object.values(activity).some((a) => a.state === 'working'), [activity]);

  return { getChat, activity, anyWorking };
}