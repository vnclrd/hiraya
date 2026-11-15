import type { UIMessage } from "ai";

// Static tools expose their name in `type` ("tool-readProjectFile"); dynamic ones use `toolName`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolName = (p: any): string => p.toolName ?? String(p.type).replace(/^tool-/, "");

/** Ids of finished `writeProjectFile` calls (used to reload once per new write). */
export const finishedWriteIds = (ms: UIMessage[]): string[] =>
  ms.flatMap((m) =>
    m.role !== "assistant"
      ? []
      : m.parts.flatMap((p, i) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          p.type.startsWith("tool-") && toolName(p) === "writeProjectFile" && (p as any).state === "output-available"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? [(p as any).toolCallId ?? `${m.id}:${i}`]
            : [],
        ),
  );
