import {
  streamText,
  tool,
  convertToModelMessages,
  stepCountIs,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { HIRAYA_PERSONAS } from '@/config/personas';
import {
  readProjectMarkdown,
  appendProjectMarkdown,
} from '@/lib/server/markdown-fs';
import { getFallbackChain, isRateLimitError } from '@/lib/server/llm-router';
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

export async function POST(req: Request) {
  const {
    messages,
    personaId = 'violet',
    projectSlug = 'sample-project',
    hop = 0,
  } = await req.json();

  const persona = HIRAYA_PERSONAS[personaId] || HIRAYA_PERSONAS.violet;

  const canDelegate = !!persona.canDelegateTo?.length && hop < MAX_HOPS;

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
            `Handed off to ${to}. Do not do their part; tell Sir briefly and stop.`,
        }),
      }
    : {};

  console.log(
    `[Hiraya Office] ${personaId} hop=${hop} canDelegate=${canDelegate} readOnly=${!!persona.readOnly} delegateTo=${persona.canDelegateTo?.join(',') ?? 'none'}`,
  );

  const rawMarkdown = await readProjectMarkdown(projectSlug);

  const trimmedContext =
    rawMarkdown.context.length > 1500
      ? rawMarkdown.context.slice(0, 1500) + '\n...[truncated for speed]...'
      : rawMarkdown.context;

  const trimmedProgress =
    rawMarkdown.progress.length > 1500
      ? rawMarkdown.progress.slice(0, 1500) + '\n...[truncated for speed]...'
      : rawMarkdown.progress;

  const trimmedMessages = messages.slice(-15);
  const modelMessages = await convertToModelMessages(trimmedMessages);

  const systemPrompt = `${persona.systemInstruction}

=== ACTIVE PROJECT: ${projectSlug} ===
--- CONTEXT.md (Summary) ---
${trimmedContext}

--- PROGRESS.md (Summary) ---
${trimmedProgress}

INSTRUCTION: You have access to tools to read, list, and write files inside the active codebase. 
- If the user asks for a file and you are unsure of its exact path, call 'listProjectFiles' first.
- If the user names an exact file or path (including dotfiles like .env or .gitignore), call 'readProjectFile' on it directly. A directory listing is not proof a file is missing: never say a file doesn't exist until 'readProjectFile' on that path has actually failed.
- The user owns this local project. When they ask to see a file, including .env files, read it and show it. Don't refuse or lecture about secrets.
- Use 'readProjectFile' to inspect existing code before making modifications.
${
  persona.readOnly
    ? "- You cannot write or modify code files, and you must never try. Report findings, designs and suggestions in your reply."
    : "- When asked to build features, fix bugs, or write code, you can use 'writeProjectFile' to modify the codebase directly on disk.\n- Always call 'readProjectFile' on a file before overwriting it with 'writeProjectFile', and keep all UI code in it unchanged unless the user explicitly asked for a UI change."
}
${
  canDelegate
    ? `- Work that belongs to a teammate (${persona.canDelegateTo!.join(', ')}) MUST be handed over by calling the 'delegateTask' tool. Never do their part yourself.\n- Never say you have instructed, assigned, or handed work to a teammate unless 'delegateTask' was actually called in this reply and returned successfully. If it was not called, say so honestly.`
    : ''
}`;

  const candidates = getFallbackChain(persona.preferredModel);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = streamText({
        model: candidate.model,
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(12), // Allows multi-step tool calls (e.g., list files then read a file)
        // Server-side gate: reviewers never get writeProjectFile; only delegators get delegateTask
        activeTools: [
          'updateMarkdownFile',
          'listProjectFiles',
          'readProjectFile',
          ...(persona.readOnly ? [] : ['writeProjectFile']),
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
              entry: z
                .string()
                .describe('Concise markdown bullet entry to append'),
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
                const projectRoot = path.resolve(
                  process.cwd(),
                  '..',
                  projectSlug,
                );
                const targetDir = path.join(projectRoot, subDirectory);
                const entries = await fs.readdir(targetDir, {
                  withFileTypes: true,
                });
                return entries
                  .filter((e) => !HIDDEN.has(e.name))
                  .map(
                    (e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`,
                  )
                  .join('\n');
              } catch (err: any) {
                return `Error listing directory: ${err.message}`;
              }
            },
          }),

          // Dynamic tool to read any file from whichever project slug is active
          readProjectFile: tool({
            description: `Read the contents of any file in the ${projectSlug} repository. You must provide the correct relative path (e.g. 'src/components/AppHeader.tsx').`,
            inputSchema: z.object({
              filePath: z
                .string()
                .describe(
                  "Relative path from project root, e.g. 'src/components/AppHeader.tsx'",
                ),
            }),
            execute: async ({ filePath }) => {
              try {
                const projectRoot = path.resolve(
                  process.cwd(),
                  '..',
                  projectSlug,
                );
                const safePath = path
                  .normalize(filePath)
                  .replace(/^(\.\.[\/\\])+/, '');
                const fullPath = path.join(projectRoot, safePath);
                const content = await fs.readFile(fullPath, 'utf-8');

                if (content.length > 10000) {
                  return (
                    content.slice(0, 10000) +
                    '\n\n...[file truncated due to length]...'
                  );
                }
                return content;
              } catch (err: any) {
                return `Error reading file at '${filePath}': ${err.message}. Try listing the directory first to find the correct path.`;
              }
            },
          }),

          // Dynamic tool to create or overwrite code files in the active repository
          writeProjectFile: tool({
            description: `Write or update code files in the ${projectSlug} repository. You overwrite the whole file, so copy every existing line you were not asked to change, especially JSX, classes, and text.`,
            inputSchema: z.object({
              filePath: z
                .string()
                .describe(
                  "Relative path from project root, e.g. 'src/components/AppHeader.tsx'",
                ),
              content: z
                .string()
                .describe('The complete file content to write'),
            }),
            execute: async ({ filePath, content }) => {
              try {
                const projectRoot = path.resolve(
                  process.cwd(),
                  '..',
                  projectSlug,
                );
                const safePath = path
                  .normalize(filePath)
                  .replace(/^(\.\.[\/\\])+/, '');
                const fullPath = path.join(projectRoot, safePath);

                // Ensure parent directories exist (e.g., if writing a file in a new folder)
                await fs.mkdir(path.dirname(fullPath), { recursive: true });

                // Write the file to disk
                await fs.writeFile(fullPath, content, 'utf-8');
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
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn(
          `[Hiraya Router] 429 hit on ${candidate.id}, failing over...`,
        );
        continue;
      }
      throw error;
    }
  }

  return new Response(
    'All configured LLM providers and free-tier models are currently rate-limited.',
    { status: 429 },
  );
}