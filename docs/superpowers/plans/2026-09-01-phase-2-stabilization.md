# Phase 2 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make releases repeatable, prevent silent data truncation, provide actionable failure diagnostics, and remove fragile direct dependencies on Supabase Auth internals.

**Architecture:** Retain the Phase 1 database transaction boundary. Add a minimal automated test stack, run it in GitHub Actions with a local Supabase instance, centralize server-side read patterns, and use small native logging and health utilities instead of adding an observability platform prematurely.

**Tech Stack:** Bun, Node test runner, Vitest where TypeScript/module mocking is required, Playwright for critical browser flows, GitHub Actions, Supabase CLI, Next.js Route Handlers.

## Global Constraints

- Phase 1 release gate must pass before Phase 2 begins.
- Persistent tests may live in `tests/` and `supabase/tests/`; temporary artifacts stay in `tmp/`.
- Start with built-in `console` JSON logging; do not add a logging dependency.
- Pagination must preserve existing URLs and role behavior.
- Do not introduce Redis, queues, read replicas, or a custom API server.
- Keep UI changes compliant with `DESIGN.md`.
- Do not commit automatically.

---

### Task 1: Add the application test foundation

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/dateHelpers.test.ts`
- Create: `tests/kinshipHelpers.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces scripts: `test`, `test:run`, `test:db`, and `verify`.

- [ ] **Step 1: Add only the required dependency**

Run:

```powershell
bun add --dev vitest
```

Do not add Testing Library until a DOM component test requires it.

- [ ] **Step 2: Add scripts**

Add:

```json
{
  "test": "vitest",
  "test:run": "vitest run",
  "test:db": "supabase test db",
  "typecheck": "tsc --noEmit",
  "verify": "bun run lint && bun run typecheck && bun run test:run && bun run build"
}
```

- [ ] **Step 3: Configure path aliases and Node environment**

Configure Vitest to resolve `@` to the repository root and default to `environment: 'node'`.

- [ ] **Step 4: Leave two runnable baseline tests**

Test deterministic existing behavior in `dateHelpers` and `kinshipHelpers`, including Vietnamese lunar/date formatting and one direct ancestor/descendant term.

- [ ] **Step 5: Run the baseline suite**

```powershell
bun run test:run
bun run typecheck
```

Expected: both tests pass without changing production behavior.

### Task 2: Add CI for every pull request and main-branch push

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: scripts from Task 1 and Supabase DB tests from Phase 1.
- Produces: required CI jobs `application` and `database`.

- [ ] **Step 1: Create the application job**

Use Ubuntu, checkout, official Bun setup, frozen install, then:

```text
bun run lint
bun run typecheck
bun run test:run
bun run build
```

Do not set Supabase environment values in the application build job; the existing missing-configuration path allows the production build to complete without secrets. Never place real secrets in workflow YAML.

- [ ] **Step 2: Create the database job**

Install the Supabase CLI using the official supported action or binary setup, start local Supabase, and run:

```text
supabase db reset
supabase test db
```

- [ ] **Step 3: Add concurrency cancellation**

Cancel an older run for the same branch when a new commit arrives.

- [ ] **Step 4: Add least-privilege workflow permissions**

Use:

```yaml
permissions:
  contents: read
```

- [ ] **Step 5: Validate workflow syntax and local parity**

Run all commands locally, then open a pull request in a test branch only when the user explicitly requests Git operations.

### Task 3: Eliminate silent 1,000-row truncation

**Files:**
- Create: `utils/supabase/pagination.ts`
- Modify: `app/dashboard/members/page.tsx`
- Modify: `app/dashboard/stats/page.tsx`
- Modify: `app/dashboard/kinship/page.tsx`
- Modify: `app/dashboard/lineage/page.tsx`
- Modify: `app/dashboard/events/page.tsx`
- Test: `tests/pagination.test.ts`

**Interfaces:**
- Produces: `fetchAllRows<T>(queryPage: (from: number, to: number) => Promise<PageResult<T>>, pageSize?: number): Promise<T[]>`.
- Produces: `PageResult<T> = { data: T[] | null; error: PostgrestError | null }`.

- [ ] **Step 1: Write tests for exact page boundaries**

Cover datasets of 0, 1, 999, 1,000, 1,001, 2,000, and 2,001 rows. Assert no duplicates and no missing rows.

- [ ] **Step 2: Implement the minimal pagination helper**

Use sequential pages of 1,000 rows. Stop on a short page. Throw the original PostgREST error; do not silently return partial data.

- [ ] **Step 3: Replace unbounded correctness-critical queries**

Use the helper for tree, kinship, lineage, stats, and events pages. Select only columns required by each page.

- [ ] **Step 4: Add true pagination to list view**

For `view=list`, support:

```text
page: positive integer, default 1
pageSize: fixed 50
query: trimmed text, max 100 characters
filter: existing allowlisted values
sort: existing allowlisted values
```

Use PostgREST `.range()` and `{ count: 'exact' }`. Keep search/filter state in URL search params.

- [ ] **Step 5: Preserve complete data for tree views temporarily**

Tree and mindmap may still fetch all pages in Phase 2 for correctness. Phase 4 replaces this with lazy subtree loading.

- [ ] **Step 6: Verify >1,000 row behavior**

Generate fictional rows in a disposable local database, load each affected page, and assert displayed or computed counts match the database.

### Task 4: Add global error boundaries and stable error identifiers

**Files:**
- Create: `app/error.tsx`
- Create: `app/global-error.tsx`
- Create: `app/dashboard/error.tsx`
- Create: `utils/errors.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Produces: `createErrorId(): string` using `crypto.randomUUID()`.
- Produces: `toPublicError(error, fallback): { id: string; message: string }`.

- [ ] **Step 1: Test public error conversion**

Assert SQL text, stack traces, URLs containing tokens, and environment values are never included in returned messages.

- [ ] **Step 2: Implement the small error utility**

Log the original error with an ID and return only the ID plus a stable Vietnamese message.

- [ ] **Step 3: Add error boundaries**

Each boundary must:

```text
display a concise Vietnamese message
display the error ID
offer retry
offer navigation to dashboard/home
avoid rendering stack traces
follow DESIGN.md tokens
```

- [ ] **Step 4: Replace raw database error exposure**

Prioritize Server Actions in `app/actions/user.ts`, `app/actions/member.ts`, `app/actions/data.ts`, and `app/actions/migrations.ts`.

- [ ] **Step 5: Verify production error rendering**

Use a temporary fault injection guarded by `NODE_ENV === 'test'`; remove it before final verification.

### Task 5: Add structured server logging

**Files:**
- Create: `utils/logger.ts`
- Modify: `app/actions/*.ts`
- Modify: `app/api/**/*.ts`
- Test: `tests/logger.test.ts`

**Interfaces:**
- Produces: `logInfo(event, fields)`, `logWarn(event, fields)`, `logError(event, error, fields)`.

- [ ] **Step 1: Define the JSON log envelope**

Every log contains:

```json
{
  "timestamp": "ISO-8601",
  "level": "info|warn|error",
  "event": "stable.event.name",
  "requestId": "uuid when available",
  "userId": "uuid when safe",
  "fields": {}
}
```

Never include passwords, tokens, approval URLs, phone numbers, residence, private notes, service keys, or DB URLs.

- [ ] **Step 2: Test PII redaction**

Pass nested objects containing `password`, `token`, `authorization`, `phone_number`, `current_residence`, and `SUPABASE_DB_URL`; assert values are replaced with `[REDACTED]`.

- [ ] **Step 3: Replace relevant console calls**

Prioritize auth callback, approval, imports, migrations, user administration, gallery storage, and relationship workflows.

- [ ] **Step 4: Keep client logging minimal**

Do not ship structured server logs to the browser. Client errors should display public messages and optionally send a future telemetry event after consent exists.

### Task 6: Add health and readiness endpoints

**Files:**
- Create: `app/api/health/route.ts`
- Create: `app/api/readiness/route.ts`
- Test: `tests/health-routes.test.ts`

**Interfaces:**
- `/api/health`: process-level liveness, no DB call.
- `/api/readiness`: verifies required public env and a bounded database query.

- [ ] **Step 1: Implement liveness**

Return status 200 with:

```json
{ "status": "ok", "version": "1.0.0" }
```

Read version from `package.json`; do not expose environment values.

- [ ] **Step 2: Implement readiness**

Use a server Supabase client and call a lightweight RPC or select limited to one row. Apply `AbortSignal.timeout(5000)` under the repository's Node 24 runtime.

Return 503 with a generic component status when unavailable.

- [ ] **Step 3: Prevent caching**

Set `Cache-Control: no-store` on both endpoints.

- [ ] **Step 4: Add Docker health check**

Update `Dockerfile` only after verifying the runner image has an available HTTP client. If it does not, use a small Bun one-liner rather than installing curl.

### Task 7: Make gallery and avatar workflows compensating and server-controlled

**Files:**
- Create: `app/actions/gallery.ts`
- Create: `app/actions/avatar.ts`
- Modify: `components/modal/UploadModal.tsx`
- Modify: `components/GalleryGrid.tsx`
- Modify: `components/MemberForm.tsx`
- Test: `tests/storage-actions.test.ts`

**Interfaces:**
- Produces: `saveGalleryItemAction(formData)` and `deleteGalleryItemAction(itemId)`.
- Produces: `saveAvatarAction(personId, file)`.

- [ ] **Step 1: Test compensation paths with mocked Supabase clients**

Cover:

```text
upload succeeds, DB insert fails: new object removed
new gallery image succeeds: old object removed only after DB update
storage delete fails: DB row remains and action returns retryable error
avatar upload succeeds, person update fails: uploaded avatar removed
```

- [ ] **Step 2: Move privileged workflow decisions to Server Actions**

Validate MIME allowlists, maximum size, UUIDs, title lengths, and admin role server-side.

- [ ] **Step 3: Generate storage names with `crypto.randomUUID()`**

Do not derive security-sensitive uniqueness from `Date.now()` and `Math.random()`.

- [ ] **Step 4: Replace client direct mutations**

Client components submit form data and render stable result objects only.

- [ ] **Step 5: Verify no orphan on injected failures**

Use a disposable local Storage environment or mocks with recorded calls.

### Task 8: Replace direct `auth.users` manipulation with Admin API

**Files:**
- Modify: `app/actions/user.ts`
- Modify: `utils/supabase/admin.ts`
- Create: `supabase/migrations/20260902090000_remove_auth_internal_admin_functions.sql`
- Modify: `components/AdminUserList.tsx`
- Test: `tests/user-actions.test.ts`

**Interfaces:**
- `adminCreateUser` uses `supabase.auth.admin.createUser`.
- `deleteUser` uses `supabase.auth.admin.deleteUser`.
- Role and active state remain in `public.profiles`.

- [ ] **Step 1: Add Server Action authorization tests**

Assert unauthenticated, inactive, editor, and member callers cannot invoke admin operations even when a service-role client is configured.

- [ ] **Step 2: Implement Admin API creation**

Use:

```ts
supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true
})
```

Then upsert `profiles`. If profile creation fails, delete the newly created auth user as compensation.

- [ ] **Step 3: Implement Admin API deletion**

Enforce existing rules: cannot delete self or the last active administrator. Delete through Admin API only after checks pass.

- [ ] **Step 4: Fix password validation mismatch**

Set the UI minimum to eight characters and duplicate the same check in the Server Action.

- [ ] **Step 5: Retire SQL functions**

Drop `admin_create_user` and `delete_user` only after all call sites use the Admin API. Retain role/status RPCs if they remain useful and tested.

### Task 9: Add dependency and security maintenance automation

**Files:**
- Create: `.github/workflows/dependency-review.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: a weekly Bun outdated report and OSV scan against the committed lockfile.

- [ ] **Step 1: Add a weekly scheduled workflow**

Use official Bun setup, install with `--frozen-lockfile`, run `bun outdated`, and save its output to the job summary. The workflow reports updates but does not edit branches or open pull requests.

- [ ] **Step 2: Add an OSV scan job**

Use the official OSV scanner action or CLI against `bun.lock`. Pin third-party actions to reviewed commit SHAs.

- [ ] **Step 3: Fail on known high or critical vulnerabilities**

Keep low/medium findings visible in the job summary and require manual triage. Do not auto-upgrade major framework versions.

- [ ] **Step 4: Document update policy**

Patch security updates: review immediately. Minor updates: weekly. Major updates: separate migration plan.

### Task 10: Complete Phase 2 verification

**Files:**
- Create: `docs/releases/2026-09-phase-2-stabilization.md`

- [ ] **Step 1: Run the complete suite**

```powershell
supabase db reset
supabase test db
bun run lint
bun run typecheck
bun run test:run
bun run build
git diff --check
```

- [ ] **Step 2: Add Playwright and run critical E2E smoke flows**

Install the single required browser:

```powershell
bun add --dev @playwright/test
bunx playwright install chromium
```

Create `playwright.config.ts` and `tests/e2e/critical-flows.spec.ts`.

Cover login, inactive-user screen, admin user creation, member read-only behavior, member list page 1/page 2, relationship creation, gallery upload/delete, export, and restore.

Run these flows in Chromium against a disposable local Supabase database with fictional data.

- [ ] **Step 3: Confirm Phase 2 release gate**

```text
CI required checks pass
no page silently truncates at 1,000 rows
global errors have stable IDs
health/readiness endpoints work
storage failure paths compensate safely
Auth administration uses official Admin API
dependency scanning runs automatically
```
