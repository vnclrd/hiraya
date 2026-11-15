"use client";

import { useEffect, type RefObject } from "react";
import { PERSONAS } from "@/config/modes";

type Options = {
  busy: boolean;
  stop: () => void;
  setView: (id: string) => void;
  toggleMemory: () => void;
  toggleCode: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
};

/** Alt+0 General, Alt+1..6 personas, Ctrl/Cmd+/ memory, Ctrl/Cmd+. code preview, "/" focus composer, Esc stop. */
export function useShortcuts({ busy, stop, setView, toggleMemory, toggleCode, composerRef }: Options) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.altKey && /^Digit[0-6]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        setView(n === 0 ? "general" : (PERSONAS[n - 1]?.id ?? "general"));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        toggleMemory();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        toggleCode();
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        composerRef.current?.focus();
      }
      if (e.key === "Escape" && busy) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, stop, setView, toggleMemory, toggleCode, composerRef]);
}
