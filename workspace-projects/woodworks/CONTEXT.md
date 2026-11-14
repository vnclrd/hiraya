# WoodWorks — CONTEXT.md

> Static architecture and rules for AI agents working in this repo.
> Generated from a code audit on 2026-11-14. Describes what the code **actually does today**.
> Where the product vision differs from the code (nested subtasks, online scratchpad), that is called out explicitly and tracked in `PROGRESS.md`.

---

## 1. Project Overview & Core Domain

**WoodWorks** is a full-stack personal task management app (React SPA + Spring Boot REST API).

Core domain concepts:

| Concept | Meaning |
|---|---|
| **User** | Email + password account. Must verify email before login. Has an `avatar` (preset id) and a `role` (subscription tier). |
| **Task** | Main unit of work: title, description, `completed`, `pinned`, `urgent`, optional group. Owned by one user. |
| **Subtask** | Checklist item under a task. **Currently flat (one level).** Premium-gated. |
| **Task Group** | User-defined label/folder for tasks. Tasks link to a group **by name string**, not by FK. |
| **Daily Task** | Recurring daily checklist item; resets via a `lastCompleted` date string. |
| **Focus Session** | A completed Pomodoro (default 25 min) logged to PostgreSQL for weekly analytics. |
| **Scratchpad** | Free-text notes panel in the right sidebar. **Currently browser-local only.** |
| **Subscription tier** | `role` string on the user: `free` (default), `premium`, `lifetime`, plus `owner` / `pioneer` (frontend-recognized). Payments are **mocked**. |

Runtime modes:
- **Live mode**: JWT-authenticated calls to the Spring Boot API.
- **Demo mode** (`?demo=true` or `VITE_DEMO_MODE=true`): no backend calls; mock tasks, separate localStorage keys (`woodworks_demo_*`), premium gates bypassed. Every mutating handler in the frontend has an `if (isDemoMode)` branch — keep it working.

Deployment: frontend on Vercel (SPA rewrite in `vercel.json`), backend as a container (Dockerfile; Cloud Run URL is the frontend fallback), PostgreSQL on Neon in production and `docker-compose` Postgres locally.

---

## 2. Tech Stack & Key Packages

### Backend (repo root)
- **Java 17**, **Spring Boot 4.1.1** (Maven)
- `spring-boot-starter-webmvc`, `-data-jpa`, `-validation`, `-security`, `-mail`
- **PostgreSQL** driver (runtime) — Neon in prod, `postgres:15-alpine` locally
- `jjwt` 0.11.5 (api/impl/jackson) for JWT (HS256, 24h)
- `BCryptPasswordEncoder` for passwords
- H2 + `h2console` are on the classpath but unused (candidates for removal)
- Hibernate `ddl-auto=update` (no migration tool)

### Frontend (`woodworks-frontend/`)
- **React 19**, **TypeScript** (no `tsconfig.json` in repo), **Vite 8**
- **Tailwind CSS 4** via `@tailwindcss/vite`
- `lucide-react` icons, `framer-motion`
- No router (manual `window.location.pathname` checks for `/verify-email` and `/reset-password`)
- No state library: one big hook (`useAppController`) returned as `app` and passed as a prop everywhere
- No HTTP library: native `fetch`

### Configuration / env
| Variable | Used by | Notes |
|---|---|---|
| `SPRING_DATASOURCE_URL` / `DATABASE_URL`, `DB_USER`, `DB_PASSWORD` | backend | defaults point to local Postgres |
| `ENCRYPTION_KEY` | backend | AES key for encrypted columns (required) |
| `EMAIL_ADDRESS`, `EMAIL_PASSWORD` | backend | Gmail SMTP |
| `FRONTEND_URL` | backend | base URL for verify/reset links |
| `ADMIN_NOTIFICATION_EMAIL_1/2` | backend | new-signup alerts |
| `PORT` | backend | default 8080 |
| `VITE_API_BASE_URL`, `VITE_DEMO_MODE` | frontend | API base and demo toggle |

`application.properties` imports an optional local `.env`. **Never hardcode or commit real secrets.**

---

## 3. Database Schema & Data Models

PostgreSQL, managed by Hibernate (`ddl-auto=update`). IDs are `BIGINT IDENTITY`.

### Entity relationships

```
users 1 ───< tasks 1 ───< subtasks
  │
  ├──< task_groups          (tasks reference a group by NAME, not FK)
  ├──< focus_sessions
  └──< daily_tasks          (plain user_id column, NOT a foreign key)
```

### Tables

**`users`** — `id`, `email` (unique, not null), `password` (BCrypt), `created_at`, `enabled` (false until verified), `verification_token`, `reset_token` + `reset_token_expiry` (legacy/unused), `reset_password_token` + `reset_password_expires_at` (the active reset flow), `avatar` (preset id or null), `role` (default `"free"`). `@OneToMany tasks` with `cascade=ALL, orphanRemoval=true`.

**`tasks`** — `id`, `title` 🔒, `description` 🔒, `completed`, `completed_at`, `pinned`, `urgent`, `group_name` 🔒, `user_id` (FK, not null, LAZY). `@OneToMany subtasks` with `cascade=ALL, orphanRemoval=true`. Entity-level validation: title `@NotBlank` `@Size(max=100)`, description `@Size(max=1000)`.

**`subtasks`** — `id`, `title`, `completed`, `task_id` (FK, not null, `@JsonIgnore` on the back-reference). 
> **Not recursive today.** There is no `parent_subtask_id`; hierarchy is exactly `task → subtasks`.

**`task_groups`** — `id`, `name` 🔒 (`@Size(max=50)`), `color`, `user_id` (FK).

**`daily_tasks`** — `id`, `user_id` (plain `Long`), `title` 🔒, `last_completed` (ISO date string `YYYY-MM-DD`).

**`focus_sessions`** — `id`, `user_id` (FK, LAZY), `session_date` (`LocalDate`, server clock), `duration_minutes` (int).

🔒 = encrypted at rest via `EncryptedStringConverter` (AES, Base64, stored as `TEXT`).

### Encryption notes (important for queries)
- Encrypted columns are **not** searchable with SQL `LIKE`/`ORDER BY`; filter/sort in memory.
- `TaskRepository.findByUserAndGroupName` works only because the cipher is deterministic (`Cipher.getInstance("AES")` → ECB). Do not change the cipher mode without migrating data and rewriting that query.
- Decryption failure silently falls back to returning the raw DB value (legacy-data tolerance).

### Subscription role logic
- Role is a single string on `users.role`. `getRole()` returns `"free"` for null.
- **Plan → role mapping** (`POST /api/subscription/upgrade`): `premium_monthly` / `premium_yearly` → `premium`; `lifetime` → `lifetime`. Prices (frontend config): $9/mo, $90/yr, $199 lifetime.
- **Backend gates** (enforced server-side): add subtask → blocked when role is `free`; `GET /api/analytics/weekly` → blocked (403) when role is `free`.
- **Frontend gates**: `isFreeRole(role)` locks the Subtasks section and the Analytics tab and opens the Plans modal. `hasFullAccess(role)` is true for `lifetime`, `owner`, `pioneer`. Demo mode bypasses gates.
- `owner` and `pioneer` roles are recognized in the UI only; there is no backend path that assigns them (set manually in the DB).
- The role is returned at login and cached in `localStorage['woodworks_user_role']`; there is no refresh endpoint yet.
- Gate pattern to follow: treat **any role other than `free`** as entitled, and check the role on the server — never rely on the UI alone.

---

## 4. Folder Structure & API Route Map

### Backend

```
src/main/java/com/woodworks/
├── WoodworksApplication.java
├── config/CorsConfig.java                  # global CORS (origin patterns "*", credentials)
├── controller/
│   ├── AuthController.java                 # /api/auth/**
│   ├── TaskController.java                 # /api/tasks
│   ├── SubtaskController.java              # /api/subtasks
│   ├── TaskGroupController.java            # /api/groups
│   ├── DailyTaskController.java            # /api/daily-tasks
│   ├── AnalyticsController.java            # /api/analytics
│   ├── SubscriptionController.java         # /api/subscription
│   ├── UserController.java                 # /api/users
│   └── HealthController.java               # /api/health
├── dto/                                    # Task*/TaskGroup* Request/Response DTOs
├── exception/GlobalExceptionHandler.java
├── model/                                  # User, Task, Subtask, TaskGroup, DailyTask, FocusSession
├── repository/                             # Spring Data JPA interfaces
├── security/                               # JwtUtil, JwtAuthenticationFilter, SecurityConfig
├── service/                                # TaskService, TaskGroupService, EmailService
└── util/EncryptedStringConverter.java
```

### Frontend

```
woodworks-frontend/src/
├── App.tsx                         # path-based screens + layout composition
├── hooks/
│   ├── useAppController.ts         # ~1.5k lines: ALL app state + handlers (returned as `app`)
│   ├── useTheme.ts                 # light/dark, persisted
│   └── useMediaQuery.ts
├── services/woodworksApi.ts        # fetch wrappers: tasks, daily tasks, groups
├── config/
│   ├── appConfig.ts                # demo flag, base URLs, storage keys
│   └── plans.ts                    # pricing, PLAN_FEATURES, role helpers
├── types/task.ts
├── utils/                          # storage.ts (loadJSON, getTodayKey), taskGroups.ts
└── components/
    ├── auth/        AuthScreen, ResetPasswordScreen, VerifyEmailScreen
    ├── layout/      AppHeader, Sidebar, RightSidebar (tabs: Inspector, Timer, Notes, Activity, Filters, Analytics)
    ├── tasks/       MainContent (task + daily cards, quick-add, voice input), SubtaskList
    ├── modals/      TaskModal, GroupModal, AccountManagerModal, PlansModal, AvatarPickerModal,
    │                DeleteAccountConfirmModal, TaskDeleteModal
    ├── guide/       GuideTour, guideSteps
    ├── analytics/   ProductivityAnalytics.tsx   # currently UNUSED duplicate of RightSidebar's analytics
    └── ui/          ToastMessage, UserAvatar, avatars
```

### API route map

All routes are JSON. Everything except `/api/auth/**` and `/api/health` requires `Authorization: Bearer <jwt>`.

| Method | Route | Purpose | Auth / gating |
|---|---|---|---|
| POST | `/api/auth/register` | Create user, email verification link, admin alert | public |
| GET | `/api/auth/verify?token=` | Enable account | public |
| POST | `/api/auth/login` | Returns `{token,email,role,avatar}`; 403 if unverified | public |
| POST | `/api/auth/forgot-password` | Email reset link (15 min expiry; non-enumerating response) | public |
| POST | `/api/auth/reset-password` | Set new password via token | public |
| POST | `/api/auth/update-avatar` | Set avatar (body: `email`, `avatar`) | ⚠️ public path (see PROGRESS) |
| GET | `/api/tasks` | List own tasks with subtasks | JWT |
| GET | `/api/tasks/{id}` | One task | JWT + owner |
| POST | `/api/tasks` | Create (`@Valid TaskRequestDto`) → 201 | JWT |
| PUT | `/api/tasks/{id}` | Full update (sets/clears `completedAt`) | JWT + owner |
| DELETE | `/api/tasks/{id}` | Delete (cascades subtasks) → 204 | JWT + owner |
| POST | `/api/subtasks/task/{taskId}` | Add subtask `{title}` | JWT + non-free role |
| PUT | `/api/subtasks/{id}` | Update `title` / `completed` | JWT |
| DELETE | `/api/subtasks/{id}` | Delete | JWT |
| GET | `/api/groups` | List groups | JWT |
| POST | `/api/groups` | Create `{name,color}` | JWT |
| DELETE | `/api/groups/{id}` | Delete; tasks in it are unassigned, not deleted | JWT + owner |
| GET/POST | `/api/daily-tasks` | List / create | JWT |
| PUT/DELETE | `/api/daily-tasks/{id}` | Update title+`lastCompleted` / delete | JWT + owner (404 otherwise) |
| POST | `/api/analytics/session` | Log a focus session `{durationMinutes}` (default 25) | JWT |
| GET | `/api/analytics/weekly` | Last 7 days: `{startDate,endDate,dailySessions{date:count}}` | JWT + non-free role |
| POST | `/api/subscription/upgrade` | Set role from `plan` | JWT (⚠️ no payment check — mock) |
| PUT | `/api/users/password` | Change password (min 8 chars) | JWT |
| DELETE | `/api/users/me` | Delete account | JWT |
| GET | `/api/health` | Keep-warm ping | public |

---

## 5. Coding Conventions & Constraints

### Backend

**Layering.** Controller → Service → Repository for tasks and groups (preferred pattern). Several controllers (Auth, Subtask, Daily, Analytics, Subscription, User) talk to repositories directly; when adding features, prefer the service layer.

**Identifying the caller.** Preferred: read the email from the JWT principal:
```java
(String) SecurityContextHolder.getContext().getAuthentication().getPrincipal()
```
(used by `TaskController`, `TaskGroupController`, `AnalyticsController`). Some controllers parse the `Bearer` header by hand — don't copy that. The JWT subject is the user's **email**.

**Authorization.** Every read/write of user-owned data must load the entity, compare `entity.getUser().getId()` with the caller's id, and reject on mismatch. Every new endpoint must verify ownership — path IDs are never trusted.

**Role gating.** Check on the server, using "role is not `free`" for premium features. Return `403` with `{"error": "..."}`.

**Validation.**
- Request bodies for new endpoints should be DTOs with `jakarta.validation` annotations and `@Valid` on the parameter (see `TaskRequestDto`, `TaskGroupRequestDto`).
- Existing entity limits: task title ≤ 100, description ≤ 1000, group name ≤ 50.
- Avoid new `Map<String,String>` request bodies and unchecked casts.

**Responses & errors.**
- Error body shape: `{"error": "message"}` for controller-level errors.
- `GlobalExceptionHandler` returns `{timestamp,status,errors{field:msg}}` (400) for validation failures and maps any uncaught `RuntimeException` to **404** (so don't rely on it for 401/403 — return those explicitly).
- Return DTOs from services, not entities (exception: `Subtask` is serialized directly with `@JsonIgnore` on its task back-reference).

**Persistence.**
- Sensitive free-text columns use `@Convert(converter = EncryptedStringConverter.class)` + `columnDefinition = "TEXT"`. New user-content text fields should follow suit.
- Don't add `ORDER BY`/`LIKE` on encrypted columns.
- Use `JOIN FETCH` (as in `findByUserEmailWithSubtasks`) to avoid lazy-load N+1 on task lists.

**Naming.** Package `com.woodworks.<layer>`; classes `XController`, `XService`, `XRepository`, `XRequestDto`, `XResponseDto`; tables plural snake_case (`task_groups`); routes under `/api/<plural-noun>` in kebab-case.

**Secrets.** Read from environment via `${VAR}` in `application.properties`; never commit keys or passwords.

### Frontend

- **One controller hook.** State and handlers live in `useAppController`; components receive `app: AppController` and destructure what they need. New cross-cutting state goes there; purely local UI state stays in the component.
- **Do not rename existing state variables, handler names, API payload fields, or endpoint paths** unless the backend changes in the same change — UI work must not alter the backend contract.
- **Demo mode parity.** Every handler that hits the API needs an `isDemoMode` branch that mutates local state only.
- **Premium gating in UI:** `const locked = !app.isDemoMode && isFreeRole(app.userRole)`; show an upgrade prompt that calls `app.setIsPlansModalOpen(true)`.
- **API access:** prefer adding wrappers in `services/woodworksApi.ts` over new inline `fetch` calls; send `Authorization: Bearer ${token}`; handle non-OK with a thrown `Error` and a toast via `app.showToast`.
- **Storage keys** are prefixed `woodworks_` and defined in `config/appConfig.ts` / `services/woodworksApi.ts`. Token goes to `localStorage` when "remember me" is on, otherwise `sessionStorage`. Wrap storage access in `try/catch`.
- **Components:** function components + TypeScript props; folders by domain; icons from `lucide-react`; always include `aria-label`s on icon buttons and ARIA roles for tabs/dialogs (existing code does).
- **Styling/theme (Tailwind 4):**
  - Brand dark `#212529`, hover `#495057`.
  - Right sidebar background `#BF5700`; cards on it `#914000`; light text `#FFE8D1`.
  - Light/dark handled by `.dark` class on `<html>` and semantic classes (`bg-page`, `text-fg`, `text-fg-3`, `bg-chip`, `border-line`) defined in `index.css`. Don't hardcode light-only colors in new main-area UI.
- **Responsive:** phones show the main task card full width and hide the right sidebar entirely; the "Daily" card becomes a panel toggled from a chip strip (`useMediaQuery`).
- **Onboarding:** new features in the sidebar/tool areas should get a step in `components/guide/guideSteps.ts` (use `data-guide="..."` anchors).

### Operational constraints
- `/api/health` exists as a keep-warm endpoint (for an external pinger/uptime monitor); the frontend does not call it. The frontend tracks `isBackendOnline` from task-fetch results and shows an offline banner, using the localStorage task cache as fallback.
- Server dates (`LocalDate.now()`) use the server timezone; the client uses local dates. Be explicit about which one a feature depends on.
- **[2026-11-14]** - **Production URL**: https://woodworks-ptms.vercel.app/ (added 2026-11-14)
