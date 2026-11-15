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

const PATH_RE = /^[\w@.\-/\\]+\.[A-Za-z0-9]+$/;

export const codeKey = (c: string) => c.replace(/\r\n/g, "\n").trim();

/** Fenced blocks in order, each with the path-like inline code that directly precedes it. */
export function fencesWithPaths(text: string) {
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g;
  const out: { lang: string; code: string; path?: string }[] = [];
  let lastPath: string | undefined;
  for (const m of text.matchAll(re)) {
    if (m[3] !== undefined) {
      if (PATH_RE.test(m[3].trim())) lastPath = m[3].trim();
      continue;
    }
    out.push({ lang: m[1] || "text", code: m[2], path: lastPath });
    lastPath = undefined;
  }
  return out;
}

export function pathsByCode(text: string) {
  const map = new Map<string, string>();
  for (const f of fencesWithPaths(text)) if (f.path) map.set(codeKey(f.code), f.path);
  return map;
}

const langFromPath = (p: string) => LANGS[p.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

/** Code the assistant generated in this thread: fenced blocks (4+ lines) and files it wrote to disk. */
export function extractArtifacts(messages: UIMessage[]): Artifact[] {
  const out: Artifact[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts.forEach((p, i) => {
      if (p.type === "text") {
        let k = 0;
                for (const f of fencesWithPaths(p.text)) {
          const { code, path } = f;
          if (code.split("\n").length < 4) continue;
          if (out.some((a) => a.kind === "snippet" && a.code.trim() === code.trim())) continue;
          out.push({
            id: `${m.id}:${i}:${k++}`,
            filename: path ? path.split(/[\\/]/).pop()! : `snippet.${f.lang}`,
            path,
            lang: path ? langFromPath(path) : f.lang,
            code,
            kind: "snippet",
          });
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
