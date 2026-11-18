import {
  streamText,
  tool,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { HIRAYA_PERSONAS } from '@/config/personas';
import {
  readProjectMarkdown,
  appendProjectMarkdown,
} from '@/lib/server/markdown-fs';
import { pickCandidate, describeError } from '@/lib/server/llm-router';
import fs from 'fs/promises';
import path from 'path';

// Hidden from directory listings (noise), but dotfiles like .env / .gitignore stay visible
const HIDDEN = new Set([
  '.git',
  '.next',
  'node_modules',
  '.DS_Store',
  '.idea',
  '.vscode',
]);

const MAX_HOPS = 3; // stops runaway delegation chains (keep in sync with hooks/use-office.ts)

const MAX_READ_CHARS = 40_000; // per readProjectFile call (~10k tokens)
const MAX_TOTAL_READ_CHARS = 150_000; // per request, so tool results can't flood the context
// Memory comes from CONTEXT.md / PROGRESS.md, not from the chat thread: only a short recent window is sent
const HISTORY_WINDOW = 6; // messages from the chat thread sent to the model (the browser keeps the full thread for you)
const MAX_CONTEXT_CHARS = 6000; // CONTEXT.md budget in the system prompt
const MAX_PROGRESS_CHARS = 4000; // PROGRESS.md budget in the system prompt (newest entries)
const MAX_PRELOAD_FILES = 3; // files named in a task that are loaded into the prompt up front
const MAX_PRELOAD_CHARS = 30_000; // per pre-loaded file; larger files are paged with readProjectFile
const MAX_PRELOAD_TOTAL = 60_000; // across all pre-loaded files
const MAX_DROP_RATIO = 0.1; // writeProjectFile may drop at most 10% of existing lines...
const MIN_DROP_ALLOWED = 5; // ...or 5 lines, whichever is larger, without explicit confirmation

/** Resolve a user/model-supplied path inside root; throws if it escapes the root. */
function resolveSafe(root: string, p: string) {
  const full = path.resolve(root, p);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Path escapes the project root');
  }
  return full;
}

/**
 * Keep the last `max` messages, but never start the history on an assistant message.
 * Gemini rejects a conversation whose first turn is a model turn with a function call
 * ("function call turn comes immediately after a user turn or after a function response turn").
 */
function trimHistory<T extends { role: string }>(all: T[], max = 15): T[] {
  let start = Math.max(0, all.length - max);
  while (start < all.length && all[start].role !== 'user') start++;
  return start < all.length ? all.slice(start) : all.slice(-max);
}

/** Text-only copy of a message: drops tool calls/results, reasoning and attachments (they are noise for later turns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compactMessage(m: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = (m.parts ?? []).flatMap((p: any) => {
    if (p.type === 'text') return p.text?.trim() ? [p] : [];
    if (p.type === 'file') {
      return [{ type: 'text', text: `[attachment omitted: ${p.filename ?? p.mediaType}]` }];
    }
    return [];
  });
  return { ...m, parts };
}

/**
 * History sent to the model: a short window, text only, except the newest user message, which stays intact
 * (so a file attached right now still reaches the model). Always starts on a user message.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHistory(all: any[]) {
  const windowed = trimHistory(all, HISTORY_WINDOW);
  let lastUser = -1;
  for (let i = windowed.length - 1; i >= 0; i--) {
    if (windowed[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  const compacted = windowed
    .map((m, i) => (i === lastUser ? m : compactMessage(m)))
    .filter((m) => m.parts?.length > 0);
  return trimHistory(compacted, compacted.length);
}

/** Keep the head (title/spec) and the tail (newest appended entries) of a markdown file within budget. */
function fitMarkdown(text: string, max: number, head: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, head)}\n...[middle omitted]...\n${text.slice(-(max - head))}`;
}

export async function POST(req: Request) {
  const {
    messages,
    personaId = 'violet',
    projectSlug = 'sample-project',
    hop = 0,
  } = await req.json();

  const persona = HIRAYA_PERSONAS[personaId] || HIRAYA_PERSONAS.violet;

  const canDelegate = !!persona.canDelegateTo?.length && hop < MAX_HOPS;

  // Repo folder for this project; must be a direct child of the workspace parent folder
  const reposParent = path.resolve(process.cwd(), '..');
  const projectRoot = path.resolve(reposParent, projectSlug);
  if (path.dirname(projectRoot) !== reposParent) {
    return new Response('Invalid project slug', { status: 400 });
  }

  // Per-request read tracking. Created inside POST, so it resets every request:
  // a persona that read a file last turn must read it again before overwriting it.
  const readState = new Map<
    string,
    { totalLines: number; covered: Set<number> }
  >();
  let readChars = 0;

  // Files the persona changes in this reply; logged to PROGRESS.md automatically when the reply ends
  const changedFiles = new Set<string>();

  const delegateTools: ToolSet = canDelegate
    ? {
        delegateTask: tool({
          description: `Hand a task to a teammate. They work on it in their own chat and Sir is notified. Allowed: ${persona.canDelegateTo!.join(', ')}.`,
          inputSchema: z.object({
            to: z.enum(persona.canDelegateTo as [string, ...string[]]),
            brief: z
              .string()
              .describe(
                'Complete, self-contained instructions for the teammate',
              ),
            files: z
              .array(z.string())
              .optional()
              .describe('Relative paths the teammate should look at'),
          }),
          execute: async ({ to }) =>
            `Handed off to ${to}.`,
        }),
      }
    : {};

  console.log(
    `[Hiraya Office] ${personaId} hop=${hop} canDelegate=${canDelegate} readOnly=${!!persona.readOnly} delegateTo=${persona.canDelegateTo?.join(',') ?? 'none'}`,
  );

  const rawMarkdown = await readProjectMarkdown(projectSlug);

  // Both files are appended to, so the newest entries are at the end: keep the tail of each
  const trimmedContext = fitMarkdown(rawMarkdown.context, MAX_CONTEXT_CHARS, 2000);
  const trimmedProgress = fitMarkdown(rawMarkdown.progress, MAX_PROGRESS_CHARS, 500);

  const trimmedMessages = buildHistory(messages);
  // Tool calls that never got a result (e.g. a stopped reply) would also break Gemini's turn order
  const modelMessages = await convertToModelMessages(trimmedMessages, {
    ignoreIncompleteToolCalls: true,
  });

  // Pre-load the files named in a delegated task ("Files: a, b" on the last line of the brief), so the
  // persona starts with them in full instead of spending steps on listing and reading.
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
  const lastUserText: string = (lastUserMsg?.parts ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => p.type === 'text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => p.text)
    .join('\n');
  const named: string[] =
    lastUserText
      .match(/\n\nFiles: ([^\n]+)\s*$/)?.[1]
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, MAX_PRELOAD_FILES) ?? [];

  let preloaded = '';
  for (const rel of named) {
    try {
      const full = resolveSafe(projectRoot, rel);
      const buf = await fs.readFile(full);
      if (buf.includes(0) || buf.length > MAX_PRELOAD_CHARS || preloaded.length + buf.length > MAX_PRELOAD_TOTAL) {
        continue; // binary or large: the persona pages through it with readProjectFile
      }
      const text = buf.toString('utf-8');
      const lines = text.split('\n');
      // Counts as fully read, so the overwrite guard doesn't force a second read
      readState.set(full, {
        totalLines: lines.length,
        covered: new Set(lines.map((_, i) => i + 1)),
      });
      preloaded += `\n--- ${rel} (complete file) ---\n${text}\n`;
    } catch {
      // wrong path from the delegator: the persona can still list/read normally
    }
  }
  const preloadedBlock = preloaded
    ? `\n=== PRE-LOADED FILES (already read in full; do not read them again) ===${preloaded}`
    : '';

  const systemPrompt = `${persona.systemInstruction}

=== ACTIVE PROJECT: ${projectSlug} ===
--- CONTEXT.md (Summary) ---
${trimmedContext}

--- PROGRESS.md (Summary) ---
${trimmedProgress}
${preloadedBlock}
INSTRUCTION: You have access to tools to read, list, and write files inside the active codebase. 
- If the user asks for a file and you are unsure of its exact path, call 'listProjectFiles' first.
- If the user names an exact file or path (including dotfiles like .env or .gitignore), call 'readProjectFile' on it directly. A directory listing is not proof a file is missing: never say a file doesn't exist until 'readProjectFile' on that path has actually failed.
- The user owns this local project. When they ask to see a file, including .env files, read it and show it. Don't refuse or lecture about secrets.
- Work efficiently: you have few tool rounds. Files named in a task are pre-loaded above when present, so do not list or read them again. Call independent tools together in the same step. Changes you make to files are logged to PROGRESS.md automatically, so use 'updateMarkdownFile' only for decisions or finished milestones, and put no date in the entry.\n- Your memory of earlier work is CONTEXT.md and PROGRESS.md above; only the last few chat messages are included, and earlier tool results are not. Re-read files you need instead of relying on the chat, and record decisions or finished milestones that later sessions need with 'updateMarkdownFile'.\n- Use 'readProjectFile' to inspect existing code before making modifications. Large files are returned in chunks: if a result ends with [MORE], call 'readProjectFile' again with the offset it gives until you have read the whole file.
${
  persona.readOnly
    ? '- You cannot write or modify code files, and you must never try. Report findings, designs and suggestions in your reply.'
    : "- When asked to build features, fix bugs, or write code, change files directly on disk.\n- To change an existing file, use 'editProjectFile' with the exact snippet to replace. Every other line stays untouched.\n- Use 'writeProjectFile' only for new files, or when Sir explicitly asked for a full rewrite. It overwrites the whole file, is refused unless you have read the entire file first, and is refused if it would remove many existing lines. Copy every line you were not asked to change exactly as it is."
}
${
  canDelegate
    ? `- Work that belongs to a teammate (${persona.canDelegateTo!.join(', ')}) MUST be handed over by calling the 'delegateTask' tool. Never do their part yourself.\n- Finish your own work (reads, edits) first. Then hand off by writing one short sentence to Sir and calling 'delegateTask' in that same step; the call ends your turn, so write nothing after it. Never say you handed work to a teammate unless you call 'delegateTask' in that step.`
    : ''
}`;

  const candidate = pickCandidate(persona.preferredModel);

  const maxSteps = hop > 0 ? 7 : 8;

  const result = streamText({
    model: candidate.model,
    system: systemPrompt,
    messages: modelMessages,
    // Writers copy code back verbatim, so remove sampling randomness for them
    ...(persona.readOnly ? {} : { temperature: 0 }),
    maxRetries: 0, // retries would also count against RPM; the gate handles pacing
    // Each step is one API request. A handoff ends the turn: the persona has nothing left to do after delegating.
    stopWhen: [stepCountIs(maxSteps), hasToolCall('delegateTask')],
    // On the last allowed step offer no tools at all, so the model can only answer in text
    prepareStep: ({ stepNumber }) =>
      stepNumber >= maxSteps - 1
        ? { toolChoice: 'none' as const, activeTools: [] }
        : undefined,
    // File changes are logged for the persona, so it doesn't spend a step (and a bad date) on it
    onFinish: async () => {
      if (!changedFiles.size) return;
      try {
        await appendProjectMarkdown(
          projectSlug,
          'PROGRESS.md',
          `${persona.name} changed ${[...changedFiles].join(', ')}`,
        );
      } catch {
        // logging is best-effort
      }
    },
    // Server-side gate: reviewers never get write/edit tools; only delegators get delegateTask
    activeTools: [
      'updateMarkdownFile',
      'listProjectFiles',
      'readProjectFile',
      ...(persona.readOnly ? [] : ['editProjectFile', 'writeProjectFile']),
      ...(canDelegate ? ['delegateTask'] : []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
    tools: {
      ...delegateTools,
      updateMarkdownFile: tool({
        description:
          'Append a progress update to PROGRESS.md or a new spec/decision to CONTEXT.md',
        inputSchema: z.object({
          fileName: z.enum(['PROGRESS.md', 'CONTEXT.md']),
          entry: z.string().describe('Concise markdown bullet entry to append'),
        }),
        execute: async ({ fileName, entry }) => {
          return await appendProjectMarkdown(projectSlug, fileName, entry);
        },
      }),

      // Dynamic tool to list files inside whichever project slug is active
      listProjectFiles: tool({
        description: `List files and directories inside the ${projectSlug} repository. Use this to find where components or files are located.`,
        inputSchema: z.object({
          subDirectory: z
            .string()
            .optional()
            .describe(
              "Subdirectory path relative to project root, e.g. '' for root, 'src', or 'src/components'",
            ),
        }),
        execute: async ({ subDirectory = '' }) => {
          try {
            const targetDir = resolveSafe(projectRoot, subDirectory);
            const entries = await fs.readdir(targetDir, {
              withFileTypes: true,
            });
            return entries
              .filter((e) => !HIDDEN.has(e.name))
              .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
              .join('\n');
          } catch (err: any) {
            return `Error listing directory: ${err.message}`;
          }
        },
      }),

      // Reads a file in chunks so large files are never silently cut off
      readProjectFile: tool({
        description: `Read a file in the ${projectSlug} repository. You must provide the correct relative path (e.g. 'src/components/AppHeader.tsx'). Large files are returned in chunks: if the result ends with [MORE], call again with the offset it gives until you have the whole file.`,
        inputSchema: z.object({
          filePath: z
            .string()
            .describe(
              "Relative path from project root, e.g. 'src/components/AppHeader.tsx'",
            ),
          offset: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('1-based line number to start from. Default 1.'),
        }),
        execute: async ({ filePath, offset = 1 }) => {
          try {
            const fullPath = resolveSafe(projectRoot, filePath);
            const buf = await fs.readFile(fullPath);
            if (buf.includes(0)) {
              return `Error: '${filePath}' looks like a binary file and cannot be read as text.`;
            }

            if (readChars >= MAX_TOTAL_READ_CHARS) {
              return `Read budget for this reply is used up. Work with what you have already read, use 'editProjectFile' for changes, and tell Sir if you need more of '${filePath}'.`;
            }

            const lines = buf.toString('utf-8').split('\n');
            const total = lines.length;
            if (offset > total) {
              return `Error: offset ${offset} is past the end of '${filePath}' (${total} lines).`;
            }

            // Take whole lines up to MAX_READ_CHARS (always at least one line, so we make progress)
            let end = offset - 1;
            let size = 0;
            while (
              end < total &&
              (end === offset - 1 || size + lines[end].length + 1 <= MAX_READ_CHARS)
            ) {
              size += lines[end].length + 1;
              end++;
            }
            readChars += size;

            // Remember which lines this request has actually seen (used by the write guard)
            let st = readState.get(fullPath);
            if (!st || st.totalLines !== total) {
              st = { totalLines: total, covered: new Set<number>() };
              readState.set(fullPath, st);
            }
            for (let i = offset; i <= end; i++) st.covered.add(i);

            // No line-number prefixes: the model would copy them into its writes
            const body = lines.slice(offset - 1, end).join('\n');
            return end < total
              ? `${body}\n\n[MORE: showed lines ${offset}-${end} of ${total}. Call readProjectFile again with offset=${end + 1} to continue.]`
              : body;
          } catch (err: any) {
            return `Error reading file at '${filePath}': ${err.message}. Try listing the directory first to find the correct path.`;
          }
        },
      }),

      // Targeted edit: changes one exact snippet and leaves every other line untouched
      editProjectFile: tool({
        description: `Replace one exact, unique snippet in an existing file in the ${projectSlug} repository. Preferred over writeProjectFile for any change to an existing file. oldString must match the file exactly (including whitespace) and occur exactly once; include a few surrounding lines to make it unique.`,
        inputSchema: z.object({
          filePath: z
            .string()
            .describe("Relative path from project root, e.g. 'src/lib/utils.ts'"),
          oldString: z
            .string()
            .describe('Exact existing text to replace. Must occur exactly once.'),
          newString: z.string().describe('The replacement text'),
        }),
        execute: async ({ filePath, oldString, newString }) => {
          try {
            const fullPath = resolveSafe(projectRoot, filePath);
            const content = await fs.readFile(fullPath, 'utf-8');

            // Files with Windows line endings: let the model's \n snippets still match
            const crlf = content.includes('\r\n') && !oldString.includes('\r\n');
            const from = crlf ? oldString.replace(/\n/g, '\r\n') : oldString;
            const to = crlf ? newString.replace(/\n/g, '\r\n') : newString;

            if (!from) return 'Refused: oldString must not be empty.';
            const count = content.split(from).length - 1;
            if (count !== 1) {
              return count === 0
                ? `Refused: oldString was not found in '${filePath}'. Re-read the file and copy the snippet exactly.`
                : `Refused: oldString matched ${count} times in '${filePath}'. Include more surrounding lines so it matches exactly once.`;
            }

            // Function form of replace avoids "$&"-style substitution in code
            await fs.writeFile(fullPath, content.replace(from, () => to), 'utf-8');

            // The file changed under any earlier read; require a fresh read before a full overwrite
            readState.delete(fullPath);
            changedFiles.add(filePath);
            return `Edited ${filePath}`;
          } catch (err: any) {
            return `Error editing file at '${filePath}': ${err.message}`;
          }
        },
      }),

      // Dynamic tool to create or overwrite code files in the active repository
      writeProjectFile: tool({
        description: `Create a new file, or fully rewrite an existing one, in the ${projectSlug} repository. For changes to an existing file use editProjectFile instead. This overwrites the whole file: it is refused unless you have read the entire file in this reply, and refused if it would remove many existing lines. Copy every existing line you were not asked to change exactly as it is.`,
        inputSchema: z.object({
          filePath: z
            .string()
            .describe(
              "Relative path from project root, e.g. 'src/components/AppHeader.tsx'",
            ),
          content: z.string().describe('The complete file content to write'),
          allowLargeDeletions: z
            .boolean()
            .optional()
            .describe(
              'Set true only if Sir explicitly asked to remove or rewrite a large part of this file.',
            ),
        }),
        execute: async ({ filePath, content, allowLargeDeletions }) => {
          try {
            const fullPath = resolveSafe(projectRoot, filePath);

            const prev = await fs.readFile(fullPath, 'utf-8').catch(() => null);
            if (prev !== null) {
              // Guard 1: the whole file must have been read in this request
              const st = readState.get(fullPath);
              if (!st || st.covered.size < st.totalLines) {
                return `Refused: '${filePath}' has not been fully read in this reply. Read all of it (follow [MORE] offsets) before overwriting, or use editProjectFile for a targeted change.`;
              }

              // Guard 2: an overwrite must not silently drop existing lines
              if (!allowLargeDeletions) {
                const prevLines = prev.split('\n');
                const nextLines = new Set(content.split('\n'));
                const nonEmpty = prevLines.filter((l) => l.trim()).length;
                const dropped = prevLines.filter(
                  (l) => l.trim() && !nextLines.has(l),
                );
                if (
                  dropped.length >
                  Math.max(MIN_DROP_ALLOWED, nonEmpty * MAX_DROP_RATIO)
                ) {
                  return `Refused: this write would remove or alter ${dropped.length} existing lines in '${filePath}', for example:\n${dropped.slice(0, 5).join('\n')}\nUse editProjectFile to change only the lines that need it, or re-read the file and keep those lines exactly as they are.`;
                }
              }
            }

            // Ensure parent directories exist (e.g., if writing a file in a new folder)
            await fs.mkdir(path.dirname(fullPath), { recursive: true });

            // Write the file to disk
            await fs.writeFile(fullPath, content, 'utf-8');

            // The model now knows the exact content, so a follow-up write is allowed
            const written = content.split('\n');
            readState.set(fullPath, {
              totalLines: written.length,
              covered: new Set(written.map((_, i) => i + 1)),
            });

            changedFiles.add(filePath);
            return `Successfully wrote and updated file: ${filePath}`;
          } catch (err: any) {
            return `Error writing file at '${filePath}': ${err.message}`;
          }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { 'X-Model-Used': candidate.id },
    onError: (e) => describeError(e),
  });
}