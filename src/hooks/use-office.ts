'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Chat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage } from 'ai';
import { HIRAYA_PERSONAS } from '@/config/personas';
import { loadThread, saveThread } from '@/lib/thread-storage';
import { finishedWriteIds, toolName } from '@/lib/tool-parts';

export type Activity = {
  state: 'working' | 'unread' | 'error';
  from?: string; // persona id that handed the task over
  task?: string; // the brief, shown as a tooltip
};

type Task = { to: string; from: string; brief: string; files?: string[]; hop: number };

export const MAX_HOPS = 3; // keep in sync with api/chat/route.ts

type Options = {
  activeKey: string; // `${slug}:${personaId}` of the chat the user is looking at
  transport: ChatTransport<UIMessage>;
  onSettled: () => void; // e.g. refresh project memory
  handledWrites: RefObject<Set<string>>; // so background writes don't trigger a reload loop
};

/**
 * Owns every persona's Chat, so personas can hand tasks to each other in the background.
 * Tracks a per-chat activity badge (working / unread / error) for the sidebar.
 *
 * NOTE: the inner functions only touch refs and stable state setters, so the copies captured
 * by each Chat's onFinish at creation time never go stale.
 */
export function useOffice(opts: Options) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const chats = useRef(new Map<string, Chat<UIMessage>>());
  const queue = useRef(new Map<string, Task[]>()); // tasks waiting for a busy persona
  const seen = useRef(new Set<string>()); // delegateTask toolCallIds already dispatched

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

  /** Get (or lazily create) the Chat for a project + persona. Safe to call during render. */
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
      queue.current.set(key, [...(queue.current.get(key) ?? []), t]); // runs after it finishes
      return;
    }

    // A chat created here (not yet opened by the user) starts empty — load its saved thread first
    if (chat.messages.length === 0) {
      const stored = loadThread(key);
      if (stored?.length) chat.messages = stored;
    }

    mark(key, { state: 'working', from: t.from, task: t.brief });
    const fromName = HIRAYA_PERSONAS[t.from]?.name ?? t.from;
    void chat.sendMessage(
      {
        text: `[Task from ${fromName}]\n${t.brief}${t.files?.length ? `\n\nFiles: ${t.files.join(', ')}` : ''}`,
        metadata: { from: t.from, hop: t.hop },
      },
      { body: { personaId: t.to, projectSlug: slug, hop: t.hop } },
    );
  }

  function settle(key: string, slug: string, personaId: string) {
    const chat = chats.current.get(key);
    if (!chat) return;
    const { activeKey, handledWrites, onSettled } = optsRef.current;
    const viewing = activeKey === key;

    saveThread(key, chat.messages); // background threads must persist too
    // Background writes must not trigger the page-reload effect later; the active chat keeps its normal reload
    if (!viewing) finishedWriteIds(chat.messages).forEach((id) => handledWrites.current.add(id));
    onSettled();

    // Notify, unless the user is already looking at this chat
    const prev = activityRef.current[key];
    mark(key, viewing ? null : { state: 'unread', from: prev?.from, task: prev?.task });

    // Hand off any new delegations from this reply
    const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user');
    const hop = (lastUser?.metadata as { hop?: number } | undefined)?.hop ?? 0;
    const last = chat.messages[chat.messages.length - 1];
    const tasks: Task[] = [];
    (last?.parts ?? []).forEach((p, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const next = queue.current.get(key)?.shift(); // work that queued while this persona was busy

    // Defer a tick: some SDK versions fire onFinish just before status flips back to "ready"
    setTimeout(() => {
      tasks.forEach((t) => dispatch(t, slug));
      if (next) dispatch(next, slug);
    }, 0);
  }

  // Opening a persona's chat clears its unread/error badge (a working badge stays until it settles)
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
