"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Memory = { context: string; progress: string };
export type MemoryKey = keyof Memory;

export function useProjectMemory(slug: string) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [unseen, setUnseen] = useState<Record<MemoryKey, boolean>>({ context: false, progress: false });
  const prev = useRef<Memory | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/projects?project=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error("bad response");
      const next: Memory = await res.json();
      const p = prev.current;
      if (p) {
        setUnseen((u) => ({
          context: u.context || p.context !== next.context,
          progress: u.progress || p.progress !== next.progress,
        }));
      }
      prev.current = next;
      setMemory(next);
      setUpdatedAt(Date.now());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    prev.current = null;
    setMemory(null);
    refresh();
  }, [refresh]);

  const markSeen = useCallback((k: MemoryKey) => setUnseen((u) => ({ ...u, [k]: false })), []);
  return { memory, loading, error, updatedAt, unseen, refresh, markSeen };
}
