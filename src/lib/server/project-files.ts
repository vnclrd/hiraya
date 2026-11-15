import fs from "fs/promises";
import path from "path";

const WORKSPACE_ROOT = path.join(process.cwd(), "workspace-projects");
const SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", "workspace-projects"]);
const EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "html", "md", "mdx", "py", "java",
  "sh", "yml", "yaml", "sql", "xml", "go", "rs", "php", "rb", "vue", "svelte", "env", "toml",
]);
const TTL_MS = 30_000;
const MAX_FILES = 5000;
const MAX_DEPTH = 8;
const FILE_WORDS = /\b(files?|code|repo|repository|folder|directory|root|source)\b/i;

const cache = new Map<string, { at: number; files: string[] }>();

/** Same source as the header dropdown: folders in workspace-projects/ ("general" is scratch space). */
export async function listProjectSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "general")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Relative file paths of a project's repo — the same ../<slug> folder the chat tools read from. */
async function indexProject(slug: string): Promise<string[]> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.files;

  const root = path.resolve(process.cwd(), "..", slug);
  const files: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) await walk(full, depth + 1); // skip .git, .next, ...
      } else {
        files.push(path.relative(root, full).split(path.sep).join("/")); // dotfiles like .env are kept
      }
    }
  };
  await walk(root, 0);
  cache.set(slug, { at: Date.now(), files });
  return files;
}

const FILE_RE = /(?<![\w@])((?:[\w.-]+\/)*[\w.-]+\.([A-Za-z0-9]{1,5}))(?![\w])/g;
const DOTFILE_RE =
  /(?<![\w@])((?:[\w.-]+\/)*\.(?:env(?:\.[\w-]+)*|gitignore|npmrc|nvmrc|prettierrc|dockerignore))(?![\w-])/gi;

/** File names or paths mentioned in a prompt, e.g. "personas.ts", "src/components/ui/avatar.tsx" or ".env". */
export function fileCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FILE_RE)) {
    if (EXTS.has(m[2].toLowerCase())) out.add(m[1].replace(/^\.?\//, ""));
  }
  for (const m of text.matchAll(DOTFILE_RE)) out.add(m[1]);
  return [...out];
}

const hasFile = (files: string[], cand: string) => {
  const c = cand.toLowerCase();
  return files.some((f) => {
    const l = f.toLowerCase();
    return l === c || l.endsWith("/" + c);
  });
};

const mentions = (text: string, slug: string) =>
  new RegExp(`(^|[^\\w-])${slug.replace(/[-_]/g, "[-_ ]?")}($|[^\\w-])`, "i").test(text);

/**
 * Which project should this prompt run in? Returns a slug only when the prompt names one project
 * outright, or another project clearly matches more of the requested files than the active one.
 */
export async function resolveProject(text: string, current: string) {
  const cands = fileCandidates(text);
  if (!cands.length && !FILE_WORDS.test(text)) return null; // not asking for code at all

  const cur = current === "general" ? "" : current;
  const slugs = await listProjectSlugs();
  const all = cur && !slugs.includes(cur) ? [cur, ...slugs] : slugs;

  const indexes = new Map<string, string[]>();
  await Promise.all(all.map(async (s) => indexes.set(s, await indexProject(s))));

  // Naming a project outright wins: "the .env in the root of WoodWorks"
  const named = all.filter((s) => mentions(text, s));
  if (named.length === 1) {
    const slug = named[0];
    return slug === cur ? null : { slug, files: cands.filter((c) => hasFile(indexes.get(slug)!, c)) };
  }

  const score = new Map<string, number>();
  for (const s of all) score.set(s, cands.filter((c) => hasFile(indexes.get(s)!, c)).length);

  const best = Math.max(0, ...score.values());
  if (best === 0) return null;

  let top = all.filter((s) => score.get(s) === best);
  if (top.length > 1) {
    const mentioned = top.filter((s) => mentions(text, s)); // tie: an explicit mention breaks it
    if (mentioned.length === 1) top = mentioned;
  }
  if (top.length !== 1 || top[0] === cur) return null;

  const slug = top[0];
  return { slug, files: cands.filter((c) => hasFile(indexes.get(slug)!, c)) };
}

/** Diagnostics for GET /api/projects/resolve: what the resolver can actually see on disk. */
export async function debugResolve(text: string, current: string) {
  const slugs = await listProjectSlugs();
  const projects = await Promise.all(
    slugs.map(async (slug) => {
      const root = path.resolve(process.cwd(), "..", slug);
      const exists = await fs.stat(root).then(() => true, () => false);
      return { slug, repoFolder: root, exists, indexedFiles: exists ? (await indexProject(slug)).length : 0 };
    }),
  );
  return { cwd: process.cwd(), candidates: fileCandidates(text), projects, result: await resolveProject(text, current) };
}