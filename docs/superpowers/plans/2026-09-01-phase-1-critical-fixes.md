# Phase 1 Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate known data-loss paths, align authorization with the documented role model, and make relationship writes and database upgrades deterministic.

**Architecture:** Keep the Next.js monolith and Supabase architecture. Move multi-statement data mutations into PostgreSQL functions so each business operation runs in one database transaction, while Server Actions remain the authenticated application boundary and UI components only collect input and display results.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Supabase Auth/PostgREST/PostgreSQL/Storage, PL/pgSQL, pgTAP through Supabase CLI, Bun.

## Global Constraints

- Follow `DESIGN.md` for every UI change; do not invent tokens.
- Persistent tests required by CI may live in `supabase/tests/` or `tests/`; temporary scripts and debug artifacts stay in `tmp/`.
- Do not add microservices, queues, ORMs, repository interfaces, or a second validation framework.
- Keep RLS enabled on every table in the exposed `public` schema.
- Every privileged function must set a safe `search_path` and have explicit `REVOKE`/`GRANT` statements.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL` to client code.
- Do not modify unrelated components while extracting the affected workflows.
- Do not commit automatically; leave reviewed changes in the working tree.

---

### Task 1: Add database regression tests for current critical failures

**Files:**
- Create: `supabase/tests/database/restore_backup.test.sql`
- Create: `supabase/tests/database/custom_events_rls.test.sql`
- Create: `supabase/tests/database/relationships_integrity.test.sql`
- Modify: `README.md`

**Interfaces:**
- Consumes: Supabase local project from `supabase/config.toml`.
- Produces: Reproducible failing tests for transactional restore, role permissions, marriage normalization, parent cycles, and maximum biological parents.

- [ ] **Step 1: Confirm the Supabase CLI command surface**

Run:

```powershell
supabase --version
supabase test db --help
```

Expected: a working CLI with `test db`. If unavailable, stop and document the missing prerequisite; do not install system software automatically.

- [ ] **Step 2: Write the restore failure test**

Create a pgTAP test that:

```sql
begin;
select plan(5);

-- Seed one admin session, one existing person, one relationship, and one custom event.
-- Call public.restore_backup(jsonb) with two persons and one custom event.
-- Assert the RPC succeeds.
-- Assert old rows are gone.
-- Assert all new persons, relationships, and custom events exist.
-- Assert imported custom_events.created_by equals the calling admin.

select * from finish();
rollback;
```

Before the RPC exists, the test must fail with `function public.restore_backup(jsonb) does not exist`.

- [ ] **Step 3: Write the role matrix test**

Cover these exact expectations:

```text
admin: select/insert/update/delete custom_events
editor: select/insert/update/delete custom_events
member: select only
inactive user: no access
anon: no access
```

The member insert assertion must fail against the current policy.

- [ ] **Step 4: Write relationship invariant tests**

Assert rejection of:

```text
A married B followed by B married A
A parent of B followed by B parent of A
third biological parent for the same child
same pair marked both biological_child and adopted_child
self relationship
```

Keep the existing self-relationship test as a passing baseline; the other assertions must fail before Task 4.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
supabase test db supabase/tests/database/restore_backup.test.sql
supabase test db supabase/tests/database/custom_events_rls.test.sql
supabase test db supabase/tests/database/relationships_integrity.test.sql
```

Expected: failures correspond to missing RPC and missing invariants, not SQL syntax or fixture setup errors.

- [ ] **Step 6: Document the database test command**

Add to `README.md`:

```text
supabase start
supabase test db
```

State that Docker is required for local Supabase database tests.

### Task 2: Implement atomic backup restore

**Files:**
- Create: `supabase/migrations/20260901090000_transactional_restore.sql`
- Modify: `app/actions/data.ts`
- Modify: `types/index.ts`
- Test: `supabase/tests/database/restore_backup.test.sql`

**Interfaces:**
- Consumes: backup version 3 JSON shape already returned by `exportData`.
- Produces: `public.restore_backup(import_payload jsonb) returns jsonb`.
- Return shape: `{ persons, relationships, person_details_private, custom_events }` with integer counts.

- [ ] **Step 1: Define the RPC contract in the failing test**

Use this call shape:

```sql
select public.restore_backup(
  jsonb_build_object(
    'version', 3,
    'persons', jsonb_build_array(...),
    'relationships', jsonb_build_array(...),
    'person_details_private', jsonb_build_array(...),
    'custom_events', jsonb_build_array(...)
  )
);
```

Assert the returned JSON contains exact inserted counts.

- [ ] **Step 2: Add the migration with pre-delete validation**

Create a `SECURITY DEFINER` PL/pgSQL function with:

```sql
create or replace function public.restore_backup(import_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
```

The function must, in this order:

1. Reject callers for whom `public.is_admin()` is false.
2. Require `version = 3`.
3. Require non-empty `persons` and array values for all collections.
4. Enforce the existing maximum counts: 10,000 persons, 30,000 relationships, 10,000 private details, 10,000 events.
5. Materialize payload arrays into temporary tables.
6. Validate UUIDs, enum values, text lengths, date components, references, duplicate IDs, self-relations, and relationship invariants.
7. Delete existing rows only after every validation passes.
8. Insert persons, relationships, private details, and events.
9. Set every imported event's `created_by` to `auth.uid()`.
10. Return inserted counts with `jsonb_build_object`.

Any exception must abort the function call and roll back all deletes and inserts automatically.

- [ ] **Step 3: Lock down RPC execution**

Append:

```sql
revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
```

- [ ] **Step 4: Replace destructive application-side writes**

In `importData`, retain `validateImportPayload` for fast user feedback, then replace lines performing individual deletes/inserts with:

```ts
const { data, error } = await supabase.rpc('restore_backup', {
  import_payload: importPayload
})
```

Return only stable Vietnamese errors to the client. Log the Supabase error server-side without returning SQL details.

- [ ] **Step 5: Add the RPC result type**

Add:

```ts
export interface RestoreResult {
  persons: number
  relationships: number
  person_details_private: number
  custom_events: number
}
```

- [ ] **Step 6: Run restore tests**

Run:

```powershell
supabase db reset
supabase test db supabase/tests/database/restore_backup.test.sql
node node_modules/typescript/bin/tsc --noEmit
```

Expected: restore tests pass and TypeScript reports no errors.

### Task 3: Align `custom_events` permissions with documented roles

**Files:**
- Create: `supabase/migrations/20260901100000_align_custom_event_permissions.sql`
- Modify: `app/dashboard/events/page.tsx`
- Modify: `components/EventsList.tsx`
- Modify: `components/modal/CustomEventModal.tsx`
- Test: `supabase/tests/database/custom_events_rls.test.sql`

**Interfaces:**
- Consumes: `Profile.role` and `Profile.is_active`.
- Produces: `EventsList` prop `canEdit: boolean`; members remain read-only.

- [ ] **Step 1: Change RLS policies**

Replace mutation policies with exact semantics:

```sql
insert: public.is_admin() or public.is_editor()
update: public.is_admin() or public.is_editor()
delete: public.is_admin() or public.is_editor()
select: public.is_active_user()
```

For insert, require `auth.uid() = created_by`. For update, prevent changing `created_by` away from the existing owner unless the caller is admin.

- [ ] **Step 2: Pass permission from the server page**

Use `getProfile()` in `app/dashboard/events/page.tsx` and calculate:

```ts
const canEdit =
  profile?.is_active === true &&
  (profile.role === 'admin' || profile.role === 'editor')
```

- [ ] **Step 3: Hide mutation controls for members**

Add `canEdit` to `EventsList`. Do not render create, edit, or delete controls when false. Keep event detail navigation available.

- [ ] **Step 4: Add defense in depth to the modal**

Require `canEdit` in `CustomEventModal`. If false, render nothing and do not issue Supabase writes.

- [ ] **Step 5: Run role tests and application checks**

Run:

```powershell
supabase test db supabase/tests/database/custom_events_rls.test.sql
node node_modules/eslint/bin/eslint.js app/dashboard/events/page.tsx components/EventsList.tsx components/modal/CustomEventModal.tsx
node node_modules/typescript/bin/tsc --noEmit
```

Expected: every role assertion passes; member UI contains no mutation controls.

### Task 4: Enforce relationship graph integrity

**Files:**
- Create: `supabase/migrations/20260901110000_relationship_integrity.sql`
- Test: `supabase/tests/database/relationships_integrity.test.sql`

**Interfaces:**
- Consumes: inserts and updates on `public.relationships`.
- Produces: normalized marriage uniqueness and `public.validate_relationship_integrity()` trigger function.

- [ ] **Step 1: Add normalized marriage uniqueness**

Create a partial unique index:

```sql
create unique index relationships_unique_marriage_pair
on public.relationships (
  least(person_a, person_b),
  greatest(person_a, person_b)
)
where type = 'marriage';
```

Before creating the index, detect existing reversed duplicates and abort with a descriptive exception rather than deleting records automatically.

- [ ] **Step 2: Add parent-pair exclusivity**

Create a unique index on `(person_a, person_b)` for child relationship types so one pair cannot be both biological and adopted.

- [ ] **Step 3: Add a validation trigger**

`public.validate_relationship_integrity()` must reject:

```text
parent cycles detected by a recursive CTE
more than two biological parents for one child
marriage between a person and their direct ancestor/descendant
```

Use `security invoker`, schema-qualified object names, and `set search_path = ''`.

- [ ] **Step 4: Attach trigger to inserts and relevant updates**

Run before insert or update of `type`, `person_a`, or `person_b`.

- [ ] **Step 5: Run focused and full DB tests**

Run:

```powershell
supabase db reset
supabase test db supabase/tests/database/relationships_integrity.test.sql
supabase test db
```

Expected: all invalid graph mutations fail with stable exceptions; valid adoption, marriage, and two-parent cases pass.

### Task 5: Move relationship creation into atomic RPCs

**Files:**
- Create: `supabase/migrations/20260901120000_atomic_relationship_workflows.sql`
- Modify: `app/actions/member.ts`
- Modify: `components/RelationshipManager.tsx`
- Test: `supabase/tests/database/relationship_workflows.test.sql`

**Interfaces:**
- Produces: `public.create_spouse(person_id uuid, spouse jsonb, relationship_note text) returns uuid`.
- Produces: `public.create_children(parent_ids uuid[], children jsonb) returns jsonb`.
- Produces Server Actions: `createSpouseAction` and `createChildrenAction`.

- [ ] **Step 1: Write failing atomicity tests**

Simulate a relationship constraint failure after person creation. Assert the new person does not remain in `persons`.

- [ ] **Step 2: Implement `create_spouse`**

Validate editor/admin access, name, gender, birth year, generation, and note. Insert person and marriage in one function call. Return the new person UUID.

- [ ] **Step 3: Implement `create_children`**

Validate one or two unique parent IDs and a bounded array of children. Insert all persons and all parent-child relationships atomically. Return `{ created: number, ids: uuid[] }`.

- [ ] **Step 4: Lock down both RPCs**

Revoke from `public, anon`; grant only to `authenticated`.

- [ ] **Step 5: Add Server Action wrappers**

Validate UUIDs and payload bounds in `app/actions/member.ts`, call the RPCs, revalidate member/dashboard paths, and return stable result objects.

- [ ] **Step 6: Replace client-side loops**

Remove the sequential person/relationship inserts from `handleBulkAdd` and `handleQuickAddSpouse`. Call the new Server Actions once per user operation.

- [ ] **Step 7: Run workflow tests and lint**

Run:

```powershell
supabase test db supabase/tests/database/relationship_workflows.test.sql
node node_modules/eslint/bin/eslint.js app/actions/member.ts components/RelationshipManager.tsx
node node_modules/typescript/bin/tsc --noEmit
```

### Task 6: Add database constraints for person and event fields

**Files:**
- Create: `supabase/migrations/20260901130000_data_value_constraints.sql`
- Test: `supabase/tests/database/data_constraints.test.sql`

**Interfaces:**
- Consumes: writes to `persons`, `relationships`, `custom_events`, and `gallery_items`.
- Produces: DB-enforced bounds matching application validation.

- [ ] **Step 1: Write failing boundary tests**

Cover invalid month/day, negative generation/order, empty names, oversized text, death year before birth year, and oversized event/gallery metadata.

- [ ] **Step 2: Add constraints**

Use these limits:

```text
full_name: trimmed length 1..200
other_names/avatar_url/note/relationship note: at most 2,000
phone_number/occupation/current_residence: at most 500
custom event/gallery title: trimmed length 1..200
custom event content/location/gallery description: at most 2,000
month: 1..12 when present
day: 1..31 when present
birth_order/generation: positive when present
death_year >= birth_year when both present
```

Do not attempt calendar-perfect partial-date validation in SQL; retain application validation for month-specific days.

- [ ] **Step 3: Audit existing rows before adding constraints**

Migration must raise a descriptive exception listing counts of violating rows. Do not truncate or rewrite user data automatically.

- [ ] **Step 4: Run constraint tests**

Run:

```powershell
supabase db reset
supabase test db supabase/tests/database/data_constraints.test.sql
supabase test db
```

### Task 7: Establish one migration source of truth

**Files:**
- Create: `utils/migrations/catalog.ts`
- Modify: `app/actions/migrations.ts`
- Modify: `app/setup/page.tsx`
- Modify: `README.md`
- Modify: `docs/schema.sql`
- Modify: `docs/migrations/README.md`

**Interfaces:**
- Produces: `MIGRATION_CATALOG`, an ordered readonly array of files under `supabase/migrations`.
- Both setup SQL generation and Dashboard migration execution consume the same catalog.

- [ ] **Step 1: Add the explicit catalog**

Define every migration path in chronological order. Keep the catalog explicit so Next.js output tracing includes the files and code review shows upgrade order changes.

- [ ] **Step 2: Switch Dashboard upgrades to the catalog**

Remove the `docs/schema.sql`/`docs/migrations` list from `app/actions/migrations.ts`. Derive migration IDs from the basename of `supabase/migrations/*.sql`.

- [ ] **Step 3: Switch `/setup` to the same catalog**

Read and concatenate the catalog files. Do not dynamically glob directories at runtime.

- [ ] **Step 4: Mark legacy SQL documentation as deprecated**

Retain `docs/schema.sql` for one compatibility release, add a deprecation banner at its first line, and stop reading it from application code. Add `docs/migrations/README.md` stating that new migrations belong only in `supabase/migrations` and that both legacy locations will be removed after the compatibility release.

- [ ] **Step 5: Add a catalog completeness check**

Create `tests/migration-catalog.test.mjs` using `node:test`. It must compare catalog entries against actual `.sql` filenames under `supabase/migrations` and fail on missing, duplicate, or unsorted entries.

- [ ] **Step 6: Run the catalog check and build**

Run:

```powershell
node --test tests/migration-catalog.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
```

Expected: the new Phase 1 migrations are included in both setup and Dashboard upgrade paths.

### Task 8: Add CSP in report-only mode

**Files:**
- Create: `utils/security-headers.ts`
- Modify: `next.config.ts`
- Test: `tests/security-headers.test.mjs`

**Interfaces:**
- Produces: `buildContentSecurityPolicy(isDevelopment: boolean): string`.

- [ ] **Step 1: Write a Node test for mandatory directives**

Assert presence of:

```text
default-src 'self'
base-uri 'self'
frame-ancestors 'none'
form-action 'self'
object-src 'none'
img-src allowing self, data, blob, and Supabase HTTPS
connect-src allowing self, Supabase HTTPS/WSS, and Resend only from server code
```

Assert production output does not include `'unsafe-eval'`.

- [ ] **Step 2: Implement the policy builder**

Use a plain TypeScript function and stable directive ordering. Allow inline styles initially because current components and generated styles require them. Document this as a temporary ceiling in the plan result, not as a new abstraction.

- [ ] **Step 3: Attach report-only header**

Add `Content-Security-Policy-Report-Only` to the existing global headers. Do not replace the current security headers.

- [ ] **Step 4: Verify headers and production build**

Run:

```powershell
node --test tests/security-headers.test.mjs
node node_modules/eslint/bin/eslint.js next.config.ts utils/security-headers.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
```

Start the production server and inspect one response:

```powershell
curl.exe -I http://localhost:3000/login
```

Expected: all existing headers plus CSP report-only.

### Task 9: Complete Phase 1 verification and release notes

**Files:**
- Create: `docs/releases/2026-09-phase-1-hardening.md`
- Modify: `README.md`

**Interfaces:**
- Produces: operator-visible migration, backup, rollback, and verification instructions.

- [ ] **Step 1: Run the full verification matrix**

```powershell
supabase db reset
supabase test db
node --test tests/*.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
git diff --check
```

- [ ] **Step 2: Perform a restore drill**

Using only fictional seed data:

1. Export a backup containing persons, relationships, private details, and custom events.
2. Add a marker record after export.
3. Restore the backup.
4. Confirm the marker is gone and every exported collection matches counts/checksums.
5. Attempt an invalid restore and confirm all pre-existing rows remain unchanged.

- [ ] **Step 3: Document deployment order**

Document:

```text
backup database
deploy source containing migration catalog
apply migrations
run DB tests against staging
perform staging restore drill
deploy production
verify headers and role matrix
```

- [ ] **Step 4: Confirm Phase 1 release gate**

Phase 1 is complete only when:

```text
restore is atomic
custom events restore successfully
member is read-only
relationship invariants are DB-enforced
relationship creation is atomic
all installation paths use one migration catalog
CSP report-only is present
all verification commands pass
```
