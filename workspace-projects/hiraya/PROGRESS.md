# Hiraya — PROGRESS.md

> Engineering handoff log and roadmap. Audited from source on 2026-11-14.
> Status reflects what the code does when read; **nothing was executed or tested**, and there are no automated tests in the snapshot. Items marked ⚠️ are defects I found by reading the code.

---

## 1. Completed Milestones

### Backend
- [x] Streaming chat endpoint (`POST /api/chat`) using AI SDK `streamText` + UI message stream
- [x] Six personas with system prompts, accent colors, and starter prompts (`config/personas.ts`)
- [x] Project memory injected into the system prompt (CONTEXT.md + PROGRESS.md) with a 15-message history window
- [x] AI tools: `updateMarkdownFile` (append to CONTEXT/PROGRESS), `listProjectFiles`, `readProjectFile`; multi-step tool loops (12 steps)
- [x] Multi-provider fallback chain (Gemini tiers → OpenRouter DeepSeek free → Groq Llama), with key-gated optional tiers
- [x] Markdown memory store on disk with slug sanitization for read/append (`lib/markdown-fs.ts`)
- [x] `GET /api/projects` — returns CONTEXT.md and PROGRESS.md (placeholders when missing)
- [x] `POST /api/closeout` — saves chat transcript to `chats/`, generates a <120-word handoff summary, appends it to PROGRESS.md; its provider failover is awaited correctly
- [x] `scripts/test-router.ts` smoke test for the primary model

### Frontend
- [x] Redesigned dark UI on Tailwind 4 tokens, per-persona accent glow (`--persona`)
- [x] Persona sidebar + mobile pill strip, `Alt+1–6` shortcuts
- [x] Separate conversation per project + persona
- [x] Chat stream: bubbles, markdown (GFM tables, task lists, copy-able code), thinking indicator, stop, retry, scroll-to-latest, empty-state starters
- [x] Tool-activity chips (file reads / memory updates), model chip from `X-Model-Used`
- [x] Memory panel: tabs, rendered/raw, refresh, relative timestamp, unseen-change dot, skeleton/error states, responsive slide-over (`⌘/`)
- [x] Wrap Session action (button, `/wrap`, tooltip, spinner, notices)
- [x] Prerender-safe clock handling in the memory panel (Next 16)

---

## 2. Current State

A single-page, local-first workspace. You pick a persona and a project folder name, chat, and the AI can browse and read that project's code (from `../<slug>`), append notes to the project's memory files, and show those files live beside the chat. Wrapping a session writes a transcript and a summary to disk.

**Works as designed (by code reading):** persona switching, streaming, tool calls, memory display and refresh, manual wrap, transcript saving.

**Not yet reliable / not present:**
- Provider failover in chat (see ⚠️ below), idle auto-wrap, security of the code-reading tools.
- Chat history reload, project picker, tests, auth, rate limiting, repo docs/manifests in the snapshot.

---

## 3. Known Issues (found in code)

### Security — fix before exposing beyond localhost
- ⚠️ **Path traversal in AI tools.** `listProjectFiles` / `readProjectFile` build paths from the *unsanitized* `projectSlug` and model-controlled `subDirectory` / `filePath`. The only guard is `path.normalize(...).replace(/^(\.\.[\/\\])+/, '')`, which strips *leading* `../` only; `src/../../..` or a crafted slug escapes the project root. A prompt-injected or malicious model could read `.env.local`, SSH keys, etc. Resolve with `path.resolve` and verify the result starts with the project root; deny secrets (`.env*`, `.git`, key files).
- ⚠️ **Arbitrary write via transcripts.** `saveChatTranscript` uses the raw `projectSlug` and client-supplied `personaName` in `path.join` (only the filename part is lowercased/space-replaced). Reuse the slug sanitizer and allowlist `personaName` against `HIRAYA_PERSONAS`.
- ⚠️ Routes accept unvalidated bodies (`req.json()` destructuring, whole `messages` array trusted), no auth, no rate limit, no size caps.
- `readProjectFile` can return secrets into model context and to the configured third-party providers.

### Correctness
- ⚠️ **Chat failover never triggers.** `streamText` returns before the request completes, so a 429 surfaces inside the stream, not in the `try/catch`. Result: no fallback, and the user sees an error. Use `onError`/a pre-flight probe, or a custom wrapper that retries the next candidate before streaming.
- ⚠️ **Idle auto-wrap loops.** After each wrap, `wrapping` flips back to `false`, the effect re-runs, and the timer restarts because `messages.length > 0` still holds. Every further 30 idle minutes appends another duplicate handoff to PROGRESS.md and another transcript. Track `lastWrappedMessageCount` and skip if unchanged.
- ⚠️ **Newest progress is truncated away.** Entries are appended to the *end* of PROGRESS.md, but the prompt keeps `slice(0, 1500)` (the *oldest* text). As files grow, the model sees stale history and none of the recent entries. CONTEXT.md (typically many KB) is also cut to ~1.5K characters. Use a heading index + the last N entries, or section-aware summarization.
- ⚠️ Closeout strips trailing assistant messages before summarizing, so the final reply never reaches the summary; transcripts keep only `text` parts (tool calls/results dropped).
- ⚠️ Duplicate fallback candidates: with `preferredModel = gemini-3.5-flash-lite` the chain contains that model twice (tiers 1 and 3), wasting a retry.
- Fallback IDs (`gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-4-hydrogen`) are hardcoded; confirm they are valid for your account or move them to config.
- `X-Model-Used` shows the first candidate attempted, not necessarily the model that answered.
- Two roots for one slug (`workspace-projects/<slug>` for memory vs `../<slug>` for code) with different sanitization rules — easy to misconfigure.
- Memory files only grow (append-only, no compaction).
- Chat threads exist only in browser memory; a refresh loses them even though transcripts are saved on wrap.

### Hygiene
- No `package.json`/lockfile/`tsconfig`/README/`.env.example` in the snapshot; no tests; `catch (err: any)` in tools; `test-router.ts` default model differs from persona defaults; `page.tsx` is ~380 lines of mixed UI + orchestration.

---

## 4. Immediate Next Steps / Backlog

### P0 — Safety & correctness
1. **Shared `resolveInside(root, relPath)` helper** used by every file operation (tools, transcripts, memory); block escapes, symlinks, and secret files; allowlist `personaName`; validate request bodies with zod and cap sizes.
2. **Fix prompt context:** send heading index + most recent PROGRESS entries and a CONTEXT outline; expose a `readMemorySection` tool for on-demand detail instead of dumping 1.5K characters.
3. **Fix idle auto-wrap** (wrapped-count guard) and make closeout include the final assistant message.
4. **Real failover:** retry the next candidate on stream-time 429s; report the model that actually answered; dedupe the chain; move model IDs to config/env.

### P1 — Product
5. **Reload past sessions** from `chats/` and add a project picker (`GET /api/projects/list`) with recents.
6. **Memory compaction on wrap:** roll old PROGRESS entries into a dated summary; keep recent ones verbatim.
7. **Safer write tools:** diff/confirm UI before the AI edits CONTEXT.md; optional undo for Wrap Session.
8. **Unify roots:** make code-root and memory-root configurable (`HIRAYA_PROJECTS_DIR`) instead of implicit `../<slug>`.

### P2 — Quality & ops
9. Add `README`, `.env.example`, and commit manifests; add tests for the router, path safety, and markdown-fs; split `page.tsx` into hooks (`useThreads`, `useWrap`, `useIdleWrap`) and components.
10. Token/usage meter per persona and a model-status indicator (rate-limited tiers, last error).
- **[2026-11-14]** Updated Entropy persona description in src/config/personas.ts to precisely align with its systemInstruction.

- **[2026-11-14]** - Updated Entropy's title in `src/config/personas.ts` to match its description and systemInstruction ("Brutal Refactorer & Simplifier")

- **[2026-11-14]** - Answered user's question regarding why changes in server/config files do not reflect immediately in the browser without hot-reloading or refreshing.

- **[2026-11-14]** - Explained how static top-level constants like `PERSONAS` prevent instant HMR reflection and how to make persona configs dynamically responsive or fetched.

- **[2026-11-14]** - Updated `src/app/page.tsx` to memoize personas (`const personas = useMemo(() => Object.values(HIRAYA_PERSONAS), [])`) for immediate HMR updates.

- **[2026-11-14]** - Fixed TypeScript errors in `src/app/page.tsx` (corrected `<Markdown content={...} />` to child prop and fixed `<MemoryPanel slug={...} accent={...} />` prop mismatch).

- **[2026-11-14]** Updated persona titles in `src/config/personas.ts`: Toronto -> Systems Architect, Violet -> Lead Full-Stack Developer, Vince -> Full-Stack Developer, Blue -> QA Tester, Entropy -> Developer Experience Engineer, Emily -> Technical Writer.

- **[2026-11-14]** - Updated persona descriptions in `src/config/personas.ts` to be short, simple, and role-focused relative to their team titles.
