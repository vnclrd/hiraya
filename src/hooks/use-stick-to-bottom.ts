"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Auto-scrolls a container to the bottom on new content, but only while the reader is near the bottom. */
export function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    if (atBottom) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atBottom, ...deps]);

  return { ref, atBottom, onScroll, scrollToBottom };
}
