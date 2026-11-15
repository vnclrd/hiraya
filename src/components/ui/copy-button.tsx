"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy reply"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fg-subtle opacity-0 transition group-hover/msg:opacity-100 hover:bg-raised hover:text-fg focus-visible:opacity-100"
    >
      {done ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}
