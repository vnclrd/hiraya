# WoodWorks — PROGRESS.md

> Current implementation state, audited from the code on 2026-11-14.
> `[x]` = implemented and wired end-to-end (UI → API → DB where applicable). `[ ]` = missing, stubbed, local-only, or has a defect.
> Statuses were verified by reading the source; nothing was run or tested.

## Headline findings (read first)

The repo differs from the product description in four places:

1. **Subtasks are not nested.** One level only (`task → subtasks`); no parent reference exists in the entity, API, or UI.
2. **The scratchpad is not online.** It's saved to the browser's `localStorage` only; there is no backend table or endpoint.
3. **Analytics is only half wired.** Focus sessions are written to PostgreSQL, and `GET /api/analytics/weekly` exists, but the UI never calls it — charts read from `localStorage`.
4. **Subscription upgrade is a mock and is exploitable:** any logged-in user can `POST /api/subscription/upgrade` and receive a paid role with no payment check.

---

## 1. Completed Features

### Auth & account
- [x] Register with email verification link (SMTP) and admin signup notification
- [x] Login with BCrypt check, JWT (24h), blocked until email verified
- [x] "Remember me" (token in `localStorage` vs `sessionStorage`, remembered email)
- [x] Forgot / reset password (15-minute token, rejects reuse of current password, non-enumerating response)
- [x] Change password (min 8 chars, verifies current password)
- [x] Preset avatar picker, synced to backend and restored at login
- [x] Delete account endpoint + confirmation modal *(works only in limited cases — see §2 FK issue)*

### Tasks
- [x] Task CRUD with ownership checks in `TaskService`
- [x] Pinned and Urgent flags, `completedAt` tracking
- [x] Encrypted-at-rest title, description, and group name
- [x] Task groups: create / delete (tasks are unassigned, not deleted), sidebar listing
- [x] Daily recurring tasks: CRUD, reset by `lastCompleted` date, "x of y done today"
- [x] Search, sort (newest/oldest), filters (All / Pinned / Urgent / Done, attribute toggles)
- [x] Quick-add bar with voice-input button (UI wired in `MainContent`; speech plumbing not deeply audited)
- [x] Activity log tab (recent create/complete/delete actions; stored locally)

### Subscription / roles
- [x] Role stored on user, returned at login, cached client-side
- [x] Plans modal (monthly / yearly / lifetime) separated from Account Manager, with role-aware labels
- [x] Backend gate: adding subtasks requires a non-`free` role
- [x] Backend gate: `GET /api/analytics/weekly` returns 403 for `free`
- [x] Frontend gates for Subtasks and Analytics with upgrade prompts

### Subtasks (flat)
- [x] Add / toggle / rename / delete subtasks in the Inspector, with progress and "finish parent" nudge
- [x] Task list returned with subtasks in one query (`JOIN FETCH`)

### Focus / productivity
- [x] Pomodoro timer (focus / short break / long break, sound toggle, 4-session rounds)
- [x] Completed sessions POSTed to `POST /api/analytics/session` → `focus_sessions` table
- [x] Weekly bar chart, focus-time and session totals (premium-locked) — *from local data, see §2*

### UX / platform
- [x] Dark mode with animated theme switch, persisted
- [x] Mobile layout (full-width task card, hidden right sidebar, chip strip for filters/Daily)
- [x] First-run guided tour
- [x] Demo mode sandbox (no backend)
- [x] Toasts, offline banner, tasks cache fallback
- [x] Dockerfile, `docker-compose` Postgres, Vercel SPA rewrite, `/api/health` endpoint
- [x] Scratchpad **as a local feature** (persisted in `localStorage`, copy/clear, light/dark paper toggle)

---

## 2. In-Progress / Incomplete / Stubs

### Features that don't match the intended design
- [ ] **Nested / recursive subtasks** — add `parent_subtask_id` (self-FK, nullable), a depth cap, recursive response DTO, and indented UI with collapse. Today `Subtask` has only `task_id`.
- [ ] **Persistent online scratchpad** — currently `localStorage['woodworks_scratchpad']` only (lost on another device/browser). Needs a table (e.g. `scratchpad(user_id unique, content, updated_at)`), `GET/PUT /api/scratchpad`, debounced autosave, and conflict handling; keep local fallback for demo mode.
- [ ] **Analytics reads PostgreSQL** — `GET /api/analytics/weekly` is never called by the frontend. Charts use `localStorage['woodworks_weekly_pomodoro_history']`, so data doesn't follow the user across devices.
- [ ] Analytics content gaps: "Tasks Completed" counts all-time completed tasks (not the last 7 days); minutes are hard-coded as sessions × 25 while the API stores `durationMinutes`; "Productivity Insights" is static text; no peak-day, streak, or velocity views even though the locked-state copy promises them; `completedAt` exists but isn't aggregated.
- [ ] Dead code: `components/analytics/ProductivityAnalytics.tsx` is not imported anywhere; `RightSidebar.renderAnalytics` duplicates it. Keep one.
- [ ] Analytics timezone: sessions are dated with the server's `LocalDate.now()`, the client buckets by local date — days can mismatch.
- [ ] Focus sessions aren't linked to a task, and there's no endpoint for historical ranges beyond 7 days.
- [ ] Guided tour has no step for the **Analytics** tab (and the Subtasks section).

### Subscription & billing
- [ ] **Real payments** — `PAYMENTS_ARE_MOCK = true`; `/api/subscription/upgrade` trusts the client. No payment provider, webhook, receipt/expiry tracking, or downgrade/cancel; no `premium` expiry for monthly/yearly.
- [ ] `PLAN_FEATURES` in `config/plans.ts` is a placeholder (`// TODO: replace…`) and doesn't list the real gated features (subtasks, analytics).
- [ ] No endpoint to refresh the role (`GET /api/users/me`); the role is cached in `localStorage` and only updates at login/upgrade.
- [ ] `owner` / `pioneer` roles exist only in frontend config; nothing on the backend assigns or documents them.

### Security & authorization defects
- [ ] **Subtask endpoints lack ownership checks** — any authenticated user can add/update/delete any subtask by ID (`SubtaskController`); delete and update also skip the role gate. Cast of `request.get("completed")` can throw.
- [ ] **`POST /api/auth/update-avatar` is under the public `/api/auth/**` matcher** and trusts `email` in the body → anyone can change anyone's avatar. Move it behind JWT and use the principal.
- [ ] **`POST /api/subscription/upgrade` self-upgrade** (see above).
- [ ] **JWT signing key is regenerated on every start** (`Keys.secretKeyFor`) → all sessions die on restart and multi-instance deploys break. Load the secret from env.
- [ ] **Delete account can fail** — `focus_sessions.user_id` and `task_groups.user_id` are non-null FKs with no cascade/cleanup in `UserController`; `daily_tasks` rows (plain `user_id`) are orphaned rather than deleted.
- [ ] **Daily task create/update accepts a full `DailyTask` entity as the body** — a client-supplied `id` on POST can hit an existing row (the `userId` is then overwritten). Use a DTO.
- [ ] `GlobalExceptionHandler` maps every `RuntimeException` (incl. "Unauthorized access to task") to **404**; no distinct 401/403/409 handling, and entity-level `@Size` violations at persist time are likely to surface as 500s.
- [ ] Encryption: `Cipher.getInstance("AES")` = ECB (deterministic) and decrypt failures silently return raw data.
- [ ] CORS: global `allowedOriginPatterns("*")` with credentials, plus a redundant per-controller `@CrossOrigin` on `DailyTaskController`. Restrict to the real origins.
- [ ] Role hard-coding: `"free".equals(role)` checks are scattered; add a central `RoleGuard`/`@PreAuthorize`.

### Missing API validation
- [ ] `register` / `login` / `forgot-password`: bodies are `Map<String,String>` with no email format or password-strength checks (register has no minimum password length; null email/password can NPE).
- [ ] `TaskRequestDto`: only `@NotBlank` on title — no `@Size`, no group-name existence check.
- [ ] `TaskGroupRequestDto`: no `@Size` on name/color; duplicate group names allowed; tasks bind to groups by **name**, so renaming a group is unsupported and name collisions are possible.
- [ ] `POST /api/analytics/session`: accepts any `durationMinutes` (negative, huge, or missing-type values) and has no rate limit.
- [ ] Subtask title has no length limit; subtasks aren't encrypted while task titles are.

### Tooling & hygiene
- [ ] **Docker build is broken as committed**: `Dockerfile` runs `./mvnw`, but no Maven wrapper (`mvnw`, `.mvn/`) is in the repo.
- [ ] Tests: only the default `WoodworksApplicationTests`; no backend unit/integration tests and no frontend tests.
- [ ] No DB migrations (Flyway/Liquibase); `ddl-auto=update` in production. Unused legacy columns on `users` (`reset_token`, `reset_token_expiry`).
- [ ] No `tsconfig.json`, so TypeScript isn't type-checked; `main.jsx` imports `./App.js` for a `.tsx` file; `import.meta as any` casts.
- [ ] API config is duplicated in `config/appConfig.ts` and `services/woodworksApi.ts`; most fetch calls (subtasks, analytics, subscription, user, avatar) are inline in `useAppController.ts` (~1.5k lines) and `RightSidebar.tsx` (~1.2k lines) instead of the service layer.
- [ ] Legacy local group-assignment merge (`TASK_GROUP_ASSIGNMENTS_KEY`) remains in task loading.
- [ ] Unused dependencies: H2 + `h2console` (backend).
- [ ] `README.md` is the unmodified Vite template.

### Not present in this repo
- [ ] **AI assistant** — no `AiService`, LLM client dependency, `/api/ai` route, or chat UI exists in the uploaded code (the only trace is a code comment about an "AI chat box"). If this lives in another branch/repo, it isn't part of this snapshot.

---

## 3. Recommended Next Milestones

1. **Security hardening pass (do first).** Add ownership + role checks to all `SubtaskController` routes; move `update-avatar` behind JWT; remove or lock down `/api/subscription/upgrade` until payments exist (e.g. admin-only/dev flag); load the JWT secret from env; make account deletion clean up `focus_sessions`, `task_groups`, and `daily_tasks`; add distinct 401/403/404/409 handling in `GlobalExceptionHandler`. Fix the Dockerfile by committing the Maven wrapper.

2. **Finish analytics end-to-end.** Have the Analytics tab call `GET /api/analytics/weekly` (fall back to local data in demo mode); return minutes per day and tasks completed per day (aggregate `completedAt`); decide one timezone strategy (accept a client date or timezone offset); add validation/bounds on logged sessions; add peak day, streak, and velocity; delete the duplicate analytics component.

3. **Online scratchpad.** Add a `scratchpad` table and `GET/PUT /api/scratchpad` (validated size limit, optionally encrypted like other user text), debounce saves from the Notes tab, show a "saved/syncing" state, and import existing `localStorage` content on first sync.

4. **Nested subtasks.** Add `parent_subtask_id` with a max-depth rule (e.g. 3), a recursive DTO/endpoint shape (keep the existing flat fields for backward compatibility), recursive completion rollup, and an indented/collapsible Inspector UI. Migrate with an explicit SQL script rather than relying on `ddl-auto=update`.

5. **Real subscriptions + role refresh.** Integrate a payment provider (checkout + webhook that sets the role server-side), add plan expiry/cancel handling, a `GET /api/users/me` that refreshes role/avatar on app load, real `PLAN_FEATURES` copy, and then flip `PAYMENTS_ARE_MOCK`. Add tests around role gating at the same time (the first meaningful backend tests in the repo). The AI assistant can follow once this foundation is stable.
- **[2026-11-14]** - Updated AppHeader.tsx title to "WoodWorks - PTMS"
