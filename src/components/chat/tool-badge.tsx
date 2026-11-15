import { Check, Loader2 } from "lucide-react";
import { HIRAYA_PERSONAS } from "@/config/personas";
import { toolName } from "@/lib/tool-parts";

/** Small "Running / Completed" pill for a tool call. Finished read/list calls are hidden to keep chat clean. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ToolBadge({ part }: { part: any }) {
  const name = toolName(part);
  const done = part.state === "output-available";
  if (done && (name === "readProjectFile" || name === "listProjectFiles")) return null;

  let action = "Checking codebase";
  if (name === "readProjectFile" && part.input?.filePath) action = `Reading ${part.input.filePath}`;
  else if (name === "writeProjectFile" && part.input?.filePath) action = `Writing ${part.input.filePath}`;
  else if (name === "listProjectFiles") action = "Listing directory";
  else if (name === "delegateTask" && part.input?.to)
    action = `Handing off to ${HIRAYA_PERSONAS[part.input.to]?.name ?? part.input.to}`;
  else if (part.input?.fileName) action = `Updating ${part.input.fileName}`;

  return (
    <div className="my-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg-muted">
      {done ? <Check className="size-3 text-emerald-400" /> : <Loader2 className="size-3 animate-spin" />}
      {done ? `Completed: ${action}` : `Running: ${action}…`}
    </div>
  );
}