import type { ReactNode } from "react";

const POS = {
  top: "bottom-full mb-2 left-1/2 -translate-x-1/2",
  bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
  right: "left-full ml-2 top-1/2 -translate-y-1/2",
} as const;

export function Tooltip({
  label,
  hint,
  side = "bottom",
  children,
}: {
  label: string;
  hint?: string;
  side?: keyof typeof POS;
  children: ReactNode;
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${POS[side]} whitespace-nowrap rounded-md border border-line-strong bg-raised px-2 py-1 text-[11px] text-fg opacity-0 shadow-lg transition duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100`}
      >
        {label}
        {hint && <kbd className="ml-2 font-mono text-fg-subtle">{hint}</kbd>}
      </span>
    </span>
  );
}