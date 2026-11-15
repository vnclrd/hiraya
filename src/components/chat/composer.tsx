"use client";

import { useEffect, type RefObject } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  landing: boolean;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({ value, onChange, onSubmit, onStop, busy, landing, placeholder, inputRef }: Props) {
  // Keep the textarea height in sync with its content (also resets after send / prefill)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, landing, inputRef]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={landing ? "w-full" : "mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"}
    >
      <div
        className={`flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 transition focus-within:border-(--persona)/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--persona)_14%,transparent)] ${
          landing ? "shadow-2xl" : "shadow-lg"
        }`}
      >
        <textarea
          ref={inputRef}
          value={value}
          rows={landing ? 2 : 1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className={`block max-h-52 w-full resize-none bg-transparent px-3 py-2 outline-hidden placeholder:text-fg-subtle ${landing ? "text-base" : "text-sm"}`}
        />
        <div className="flex shrink-0 pr-0.5 pb-0.5">
          {busy ? (
            <Tooltip label="Stop generating" hint="Esc" side="top">
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                className="grid size-8 cursor-pointer place-items-center rounded-xl border border-line-strong text-fg transition hover:bg-raised"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            </Tooltip>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Send"
              className="grid size-8 cursor-pointer place-items-center rounded-xl bg-(--persona) text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
