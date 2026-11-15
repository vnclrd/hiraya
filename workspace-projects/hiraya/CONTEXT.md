# Hiraya — CONTEXT.md

> Technical orientation for AI agents and developers. Generated from a code audit on 2026-11-14.
> **Snapshot caveat:** the uploaded archive contains only `src/` and `scripts/`. There is no `package.json`, lockfile, `tsconfig`, Next config, Dockerfile, README or `.env.example`, so the stack below is **inferred from imports and code**, not from manifests. Verify versions against your `package.json`.

---

## 1. Project Overview

**Hiraya** ("Developer Mindspace") is a local-first, AI-assisted developer workspace. You chat with specialized AI **personas** about a project, and Hiraya keeps **persistent project memory** in plain Markdown files (`CONTEXT.md` for static architecture and rules, `PROGRESS.md` for the running log).

Core value:
- **Persona-specific expertise:** six personas with distinct system prompts.
- **Memory that survives sessions:** Markdown files on disk, injected into every prompt and updated by the AI through tools.
- **Codebase awareness:** the AI can list and read files in the project repo.
- **Free-tier resilience:** a multi-provider model fallback chain intended to ride through rate limits.
- **Session wrap-up:** one action summarizes a chat into `PROGRESS.md` and archives the transcript.

Personas (`src/config/personas.ts`):

| id | Name | Role | Accent |
|---|---|---|---|
| `toronto` | Toronto | Principal Systems Architect | teal |
| `violet` (default) | Violet | Lead Full-Stack Engineer | amber |
| `vince` | Vince | Rapid Debugging & Tactical Dev | rose |
| `blue` | Blue | Security, QA & Edge-Case Auditor | indigo |
| `entropy` | Entropy | Devil's Advocate & Brutal Refactorer | red |
| `emily` | Emily | Workshop Docs & Boilerplate Duo | emerald |

Each persona has `systemInstruction`, `preferredModel` (currently `gemini-3.5-flash-lite` for all), `accent` (hex, drives UI glow), and `starters` (empty-state prompts).

---

## 2. Tech Stack (inferred)

**Frontend**
- Next.js (App Router; uses the `LayoutProps<"/">` helper and `next/font/google` Geist) — behavior matches Next 16 (prerender-time `Date.now()` error)
- React (client components, hooks) + TypeScript
- Tailwind CSS 4 (`@import "tailwindcss"`, `@theme`, `@utility`; no config file)
- `lucide-react` icons, `react-markdown` + `remark-gfm`

**Backend (Next.js Route Handlers, Node runtime)**
- Vercel AI SDK: `ai` (`streamText`, `generateText`, `tool`, `convertToModelMessages`, `stepCountIs`, `DefaultChatTransport`), `@ai-sdk/react` (`useChat`, `Chat`), `zod` for tool schemas
- Providers: `@ai-sdk/google` (primary), `@ai-sdk/openai` pointed at **OpenRouter** and **Groq** (OpenAI-compatible)

**Data / storage**
- **No database.** State is the filesystem:
  - `workspace-projects/<slug>/CONTEXT.md`
  - `workspace-projects/<slug>/PROGRESS.md`
  - `workspace-projects/<slug>/chats/<ISO-timestamp>_<persona>.md` (transcripts)
- Chat threads live in browser memory only (lost on reload).

**Infrastructure / tooling**
- Runs locally via `next dev`; reads project code from a **sibling directory** `../<slug>` relative to the Hiraya working directory
- No Docker/CI files in the snapshot
- Dev script: `scripts/test-router.ts` (run with `npx tsx`, uses `dotenv`)

**Environment variables** (`.env.local`)

| Var | Purpose |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | default key read by `@ai-sdk/google` (not referenced explicitly in code) |
| `OPENROUTER_API_KEY` | enables the OpenRouter fallback tier |
| `GROQ_API_KEY` | enables the Groq fallback tier |

---

## 3. Architecture & Directory Structure

```
src/
├── app/
│   ├── layout.tsx                  # fonts, metadata, dark viewport, h-dvh shell
│   ├── globals.css                 # Tailwind 4 tokens (@theme), --persona var, utilities
│   ├── page.tsx                    # entire client UI + orchestration (single page)
│   ├── components/
│   │   ├── markdown.tsx            # custom react-markdown renderer (code copy, GFM tables/tasks)
│   │   ├── memory-panel.tsx        # useProjectMemory hook + CONTEXT/PROGRESS viewer
│   │   └── tooltip.tsx             # CSS-only accessible tooltip
│   └── api/
│       ├── chat/route.ts           # POST: streaming chat, tools, model fallback
│       ├── closeout/route.ts       # POST: wrap session (transcript + PROGRESS summary)
│       └── projects/route.ts       # GET: read CONTEXT.md + PROGRESS.md for a slug
├── config/personas.ts              # persona definitions
└── lib/
    ├── llm-router.ts               # fallback chain + rate-limit detection
    └── markdown-fs.ts              # safe-ish read/append of project Markdown, transcript saver
scripts/test-router.ts              # smoke test for the primary model
```

### Request flow

```
page.tsx (useChat, one Chat per `${slug}:${personaId}`)
   │  POST /api/chat { messages, personaId, projectSlug }
   ▼
chat/route.ts
   ├─ readProjectMarkdown(slug)  → trims each file to 1500 chars → system prompt
   ├─ last 15 messages → convertToModelMessages
   ├─ streamText(model = fallback chain candidate, tools, stopWhen: 12 steps)
   └─ toUIMessageStreamResponse (header X-Model-Used)
        tools: updateMarkdownFile · listProjectFiles · readProjectFile
   ▼
onFinish → GET /api/projects?project=slug → memory panel refresh

Wrap session (button, "/wrap", or 30-min idle)
   │  POST /api/closeout { messages, projectSlug, personaName }
   ▼
closeout/route.ts → saveChatTranscript → generateText summary → append to PROGRESS.md
```

### Two filesystem roots (important)
- **Project memory:** `<cwd>/workspace-projects/<slug>/…` (via `markdown-fs.ts`).
- **Project source code (tools):** `path.resolve(<cwd>, "..", <slug>)` — a sibling repo folder named after the slug.
These are different locations; a project needs both to get full functionality.

---

## 4. Key Modules / Features

### Chat API (`api/chat/route.ts`)
- Builds the system prompt: persona instruction + active project name + truncated CONTEXT/PROGRESS + tool-usage instructions.
- **Tools**
  - `updateMarkdownFile({fileName: "PROGRESS.md" | "CONTEXT.md", entry})` → appends a dated bullet via `appendProjectMarkdown`.
  - `listProjectFiles({subDirectory?})` → lists a directory in the sibling project repo (hides dotfiles, `node_modules`, `.next`).
  - `readProjectFile({filePath})` → reads a file (truncated at 10,000 chars).
- Multi-step tool use (`stopWhen: stepCountIs(12)`).

### Model router (`lib/llm-router.ts`)
Ordered chain: preferred Gemini model → `gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-4-hydrogen` → OpenRouter `deepseek/deepseek-chat:free` (if key) → Groq `llama-3.3-70b-versatile` (if key). `isRateLimitError` matches status 429, `RESOURCE_EXHAUSTED`, or "rate limit" text. Model IDs are hardcoded — verify they exist for your account.

### Project memory (`lib/markdown-fs.ts`)
- `readProjectMarkdown` — returns `{context, progress}` with placeholder text if files are missing.
- `appendProjectMarkdown` — appends `- **[YYYY-MM-DD]** <entry>` (multi-line entries are indented). Slug is sanitized to `[a-zA-Z0-9-_]`.
- `saveChatTranscript` — writes a Markdown transcript (text parts only) to `chats/`.

### Session wrap (`api/closeout/route.ts`)
Saves the transcript, summarizes via `generateText` (Completed / Decisions & Context / Next Steps, <120 words, flash-lite first), appends to `PROGRESS.md`. Fails over across the chain on rate limits.

### Frontend (`page.tsx` + components)
- **Persona switcher** (sidebar; mobile pill strip), `Alt+1–6` shortcuts, per-persona accent via CSS variable `--persona`.
- **Separate thread per project + persona** (`Map<string, Chat>` held in state).
- **Chat stream:** user/assistant bubbles, markdown with copy-able code blocks, thinking indicator, stop button, retry on error, tool-activity chips ("Running: Reading <path>…"), scroll-to-latest, starter prompts, auto-growing composer (`Enter` send, `Shift+Enter` newline, `/wrap` command).
- **Project folder input** (sanitized, committed on Enter/blur) drives both memory and thread selection.
- **Model chip** from the `X-Model-Used` response header.
- **Memory panel:** CONTEXT/PROGRESS tabs, rendered/raw toggle, refresh with spinner, "updated Xs ago", unseen-change dot, skeleton and error states; slide-over below `xl`, toggled with `⌘/`.
- **Wrap Session** button with tooltip and spinner, success/error notice.
- **Idle auto-wrap** after 30 minutes without activity (see `PROGRESS.md` — currently buggy).

### Conventions
- Client components marked `"use client"`; avoid reading the clock (`Date.now()`) during render (Next prerender error).
- Styling: semantic tokens in `@theme` (`canvas`, `surface`, `raised`, `line`, `fg-*`); per-persona color through `--persona`; Tailwind 4 syntax (`bg-(--persona)/15`, `outline-hidden`).
- API errors: JSON `{error}` for closeout; plain text 429 for chat when all providers are exhausted.
- Path safety for memory files goes through `resolveSafeProjectPath` (slug sanitization) — **the code-reading tools do not use it** (see `PROGRESS.md`).
- **[2026-11-15]** - Developer/User name: Miguel (addressed as Sir)
