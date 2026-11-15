import type { UIMessage } from "ai";
import { toolName } from "./tool-parts";

export type Artifact = {
  id: string;
  filename: string;
  path?: string;
  lang: string;
  code: string;
  kind: "file" | "snippet";
};

const LANGS: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", css: "css", html: "html",
  md: "markdown", py: "python", java: "java", sh: "bash", yml: "yaml", yaml: "yaml", sql: "sql", xml: "xml",
};
const langFromPath = (p: string) => LANGS[p.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

/** Code the assistant generated in this thread: fenced blocks (4+ lines) and files it wrote to disk. */
export function extractArtifacts(messages: UIMessage[]): Artifact[] {
  const out: Artifact[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts.forEach((p, i) => {
      if (p.type === "text") {
        let k = 0;
        for (const match of p.text.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)) {
          const code = match[2];
          if (code.split("\n").length < 4) continue;
          if (out.some((a) => a.kind === "snippet" && a.code.trim() === code.trim())) continue;
          const lang = match[1] || "text";
          out.push({ id: `${m.id}:${i}:${k++}`, filename: `snippet.${lang}`, lang, code, kind: "snippet" });
        }
      } else if (p.type.startsWith("tool-") && toolName(p) === "writeProjectFile") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = p as any;
        const ready = t.state === "input-available" || t.state === "output-available";
        if (ready && typeof t.input?.content === "string" && typeof t.input?.filePath === "string") {
          const path: string = t.input.filePath;
          const prev = out.findIndex((a) => a.kind === "file" && a.path === path);
          if (prev >= 0) out.splice(prev, 1); // newest version of a file wins
          out.push({ id: `${m.id}:${i}`, filename: path.split(/[\\/]/).pop() ?? path, path, lang: langFromPath(path), code: t.input.content, kind: "file" });
        }
      }
    });
  }
  return out;
}
