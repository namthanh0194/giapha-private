# Phase 3 Product Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trustworthy collaboration features—change history, source citations, duplicate handling, record-level privacy, review workflows, and accessible responsive interactions—without changing the deployment architecture.

**Architecture:** Extend PostgreSQL with narrowly scoped tables and RLS policies. Expose mutations through Server Actions/RPCs that write both domain data and audit state atomically. Keep the current UI vocabulary and progressively add controls to existing pages rather than creating a parallel administration application.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase PostgreSQL/RLS/Storage, Vitest, pgTAP, Playwright only for keyboard and responsive flows that require a real browser.

## Global Constraints

- Phase 1 and Phase 2 release gates must pass.
- Follow `DESIGN.md`; use existing colors, radii, spacing, shadows, typography, and Lucide icons.
- Body, control, label, metadata, and interactive text stay at 14px.
- Do not add a generic workflow engine, event bus, CMS, or plugin system.
- New PII and audit tables must have RLS before exposure.
- Audit records are append-only; application roles cannot update or delete them.
- Persistent tests may live in `tests/` and `supabase/tests/`; temporary artifacts stay in `tmp/`.
- Do not commit automatically.

---

### Task 1: Add append-only audit history

**Files:**
- Create: `supabase/migrations/20260903090000_audit_log.sql`
- Create: `supabase/tests/database/audit_log.test.sql`
- Create: `app/dashboard/activity/page.tsx`
- Create: `components/ActivityHistory.tsx`
- Modify: `components/HeaderMenu.tsx`
- Modify: `types/index.ts`

**Interfaces:**
- Produces table `public.audit_log`.
- Produces function `public.write_audit_log()` used by triggers.
- Produces page `/dashboard/activity`, visible to active users with private payload visible only to admins.

- [ ] **Step 1: Write failing audit tests**

Assert insert/update/delete of a person, relationship, custom event, gallery item, and profile produces one audit row containing:

```text
id
table_name
record_id
operation: INSERT|UPDATE|DELETE
actor_user_id
occurred_at
old_data
new_data
```

Assert authenticated users cannot insert, update, or delete audit rows directly.

- [ ] **Step 2: Create the append-only table**

Use `bigint generated always as identity` or UUID primary key, indexed `occurred_at`, `record_id`, `actor_user_id`, and `table_name`.

Store JSONB snapshots. For `person_details_private`, omit raw values and record only changed field names to avoid duplicating PII.

- [ ] **Step 3: Add trigger function and triggers**

Use `security definer`, `set search_path = ''`, schema-qualified names, and `auth.uid()` for actor identity. Install triggers only on the six tables required by the product.

- [ ] **Step 4: Define RLS**

```text
active users: view non-profile/non-private audit summaries
admins: view all audit rows
editor/member/anon: cannot mutate audit rows
```

- [ ] **Step 5: Build the activity page**

Use server-side pagination of 50 rows. Provide filters for date, actor, operation, and table. Do not render raw JSON; map field names to Vietnamese labels.

- [ ] **Step 6: Verify audit privacy and volume**

Run DB tests and insert 10,000 fictional audit rows locally to verify indexed pagination remains bounded.

### Task 2: Add safe undo for recent domain changes

**Files:**
- Create: `supabase/migrations/20260903100000_audit_undo.sql`
- Create: `app/actions/audit.ts`
- Modify: `components/ActivityHistory.tsx`
- Test: `supabase/tests/database/audit_undo.test.sql`
- Test: `tests/audit-actions.test.ts`

**Interfaces:**
- Produces RPC `public.undo_audit_entry(audit_id bigint) returns jsonb`.
- Produces Server Action `undoAuditEntryAction(auditId: number)`.

- [ ] **Step 1: Limit undo scope explicitly**

Support only:

```text
persons: UPDATE
relationships: INSERT and DELETE
custom_events: INSERT, UPDATE, DELETE
gallery_items: metadata UPDATE only
```

Do not support profile/user, private details, Storage objects, bulk restore, or migration changes.

- [ ] **Step 2: Write conflict tests**

Undo must fail when the current row no longer matches the audit entry's expected `new_data`, preventing an old undo from overwriting newer work.

- [ ] **Step 3: Implement atomic undo**

Require admin/editor according to the original table permission. Restore/delete the row and write a new audit entry referencing the undone entry.

- [ ] **Step 4: Add confirmation UI**

Only render undo for supported entries inside a fixed time window of 24 hours. Explain exactly what will change before confirmation.

- [ ] **Step 5: Verify chain behavior**

Test change, undo, and subsequent new change. Do not implement redo in this phase.

### Task 3: Add sources and citations

**Files:**
- Create: `supabase/migrations/20260903110000_sources_and_citations.sql`
- Create: `supabase/tests/database/sources_citations.test.sql`
- Create: `components/SourcesManager.tsx`
- Create: `components/modal/SourceModal.tsx`
- Modify: `context/MemberDetailContent.tsx`
- Modify: `types/index.ts`

**Interfaces:**
- Produces tables `sources` and `person_citations`.
- A citation links one source to one person and optionally identifies a field such as `birth_date`, `death_date`, `relationship`, or `note`.

- [ ] **Step 1: Define the minimum source model**

`sources` fields:

```text
id
title
source_type: document|book|oral_history|website|photo|other
author
publisher
publication_date
url
repository
note
created_by
created_at
updated_at
```

`person_citations` fields:

```text
id
person_id
source_id
field_name
page_reference
quotation
confidence: primary|secondary|uncertain
created_by
created_at
```

- [ ] **Step 2: Add constraints and RLS**

Active users may read. Admin/editor may create and edit. Members remain read-only. Limit URL/text lengths and prevent duplicate identical citations.

- [ ] **Step 3: Add DB tests**

Cover role matrix, cascade behavior, duplicate rejection, and deleted source references.

- [ ] **Step 4: Add member detail integration**

Display a “Nguồn tư liệu” section after biographical information. Group citations by field and show confidence without using color as the only indicator.

- [ ] **Step 5: Add create/edit modal**

Use native labels, keyboard focus, `role="dialog"`, `aria-modal="true"`, Escape handling, and focus restoration.

- [ ] **Step 6: Add GEDCOM mapping**

Update export/import only for citation fields with a deterministic mapping. Preserve unsupported GEDCOM source content in notes rather than silently dropping it.

### Task 4: Add duplicate detection and controlled merge

**Files:**
- Create: `utils/duplicates.ts`
- Create: `app/actions/duplicates.ts`
- Create: `app/dashboard/duplicates/page.tsx`
- Create: `components/DuplicateReview.tsx`
- Create: `supabase/migrations/20260903120000_merge_person_records.sql`
- Test: `tests/duplicates.test.ts`
- Test: `supabase/tests/database/merge_person_records.test.sql`

**Interfaces:**
- Produces pure function `scoreDuplicateCandidate(left: Person, right: Person): DuplicateScore`.
- Produces RPC `public.merge_person_records(primary_id uuid, duplicate_id uuid, resolution jsonb) returns uuid`.

- [ ] **Step 1: Implement deterministic candidate scoring**

Score only these signals:

```text
normalized full name
other names
gender
birth year/month/day overlap
death year overlap
shared parents
shared spouse
```

Return score 0..100 and matched reasons. Never auto-merge.

- [ ] **Step 2: Add focused pure tests**

Include Vietnamese diacritics, reversed name order, partial dates, same-name different-generation people, and spouses with similar data.

- [ ] **Step 3: Build paginated candidate discovery**

Generate candidates server-side in bounded batches. Start with same normalized name or same birth year; do not compare every pair in JavaScript.

- [ ] **Step 4: Implement atomic merge RPC**

The RPC must:

```text
require admin/editor
lock both person rows
apply explicit field resolutions
move relationships without creating duplicates or cycles
move citations and private details
delete the duplicate person
write audit entries
```

- [ ] **Step 5: Build side-by-side review UI**

Require the user to choose which value wins for every conflicting field. Show relationship consequences before merge.

- [ ] **Step 6: Test rollback on constraint conflict**

Inject a conflicting relationship and assert neither person is changed when merge fails.

### Task 5: Add record-level privacy for living people

**Files:**
- Create: `supabase/migrations/20260903130000_person_privacy.sql`
- Create: `supabase/tests/database/person_privacy.test.sql`
- Modify: `components/MemberForm.tsx`
- Modify: `context/MemberDetailContent.tsx`
- Modify: `app/actions/data.ts`
- Modify: `types/index.ts`

**Interfaces:**
- Adds `persons.privacy_level`: `family`, `editors`, or `admins`.
- Field-level hiding is explicitly out of scope for this phase.

- [ ] **Step 1: Choose the minimum privacy model**

Default to `family`. Do not create arbitrary per-user ACLs in this phase.

- [ ] **Step 2: Add RLS visibility tests**

```text
family: every active user may read
editors: admin/editor may read
admins: admin only
inactive/anon: no access
```

Ensure relationships do not leak names or private person payload through embedded joins.

- [ ] **Step 3: Add privacy controls to MemberForm**

Only admin/editor may set privacy. Explain impact in Vietnamese and preserve current default behavior.

- [ ] **Step 4: Render hidden relatives safely**

Tree algorithms may need placeholder nodes to preserve structure. Render “Thành viên riêng tư” without name, avatar, dates, notes, or detail links.

- [ ] **Step 5: Apply privacy to export**

Full backup remains admin-only and includes all records. Any future member-facing export must respect RLS and privacy; add a regression test now.

### Task 6: Add review-before-publish for member contributions

**Files:**
- Create: `supabase/migrations/20260903140000_change_requests.sql`
- Create: `supabase/tests/database/change_requests.test.sql`
- Create: `app/actions/change-requests.ts`
- Create: `app/dashboard/reviews/page.tsx`
- Create: `components/ChangeRequestList.tsx`
- Modify: `components/HeaderMenu.tsx`

**Interfaces:**
- Produces `change_requests` with target table, target ID, operation, proposed JSON, status, requester, reviewer, timestamps, and review note.
- Produces RPCs `submit_change_request`, `approve_change_request`, and `reject_change_request`.

- [ ] **Step 1: Keep scope narrow**

Allow member proposals only for:

```text
person biographical corrections
new custom events
source/citation additions
```

Do not allow member proposals for roles, privacy settings, user accounts, bulk import, deletion, or relationship graph changes in this phase.

- [ ] **Step 2: Add state constraints**

Statuses: `pending`, `approved`, `rejected`, `withdrawn`. Only valid transitions are permitted. Approval applies the domain mutation and status update in one transaction.

- [ ] **Step 3: Add RLS tests**

Members see their requests. Admin/editor see pending requests. Only admin/editor approve/reject. Requesters may withdraw only pending requests.

- [ ] **Step 4: Add review UI**

Show field-level before/proposed values. Reviewer must enter a note when rejecting. Approval confirmation lists resulting changes.

- [ ] **Step 5: Add notifications without a queue**

Reuse Resend synchronously after transaction success. Email failure must not roll back an approved change; log and display notification status separately.

### Task 7: Fix modal and interactive-element accessibility

**Files:**
- Create: `components/modal/DialogShell.tsx`
- Modify: `components/modal/UploadModal.tsx`
- Modify: `components/modal/CustomEventModal.tsx`
- Modify: `components/modal/MemberDetailModal.tsx`
- Modify: `components/GalleryGrid.tsx`
- Modify: `components/PersonCard.tsx`
- Test: `tests/dialog-accessibility.test.tsx`
- Test: `tests/keyboard-navigation.test.tsx`

**Interfaces:**
- Produces one shared `DialogShell` because three existing modals need the same semantics and focus behavior.

- [ ] **Step 1: Add the minimal DOM test dependency**

Only now add:

```powershell
bun add --dev @testing-library/react @testing-library/user-event jsdom
```

- [ ] **Step 2: Write failing dialog tests**

Assert:

```text
role=dialog
aria-modal=true
accessible title
initial focus inside
Tab stays inside
Escape closes when safe
focus returns to trigger
background is not keyboard-interactive
```

- [ ] **Step 3: Implement `DialogShell`**

Use React and native DOM APIs. Do not add another dialog dependency while the required behavior is small and testable.

- [ ] **Step 4: Replace clickable divs**

Gallery cards and other primary controls become `<button>` or `<a>` elements. Preserve layout with CSS; support Enter and Space natively.

- [ ] **Step 5: Add meaningful labels**

Icon-only controls receive Vietnamese `aria-label`. Decorative SVGs and emoji replacements are `aria-hidden`.

- [ ] **Step 6: Verify screen-reader structure**

Run automated tests and manually inspect heading order, form labels, error associations, and focus sequence.

### Task 8: Bring affected UI into DESIGN.md compliance

**Files:**
- Modify only files touched by Tasks 1–7
- Modify: `app/setup/page.tsx`
- Modify: `app/dashboard/lineage/page.tsx`
- Test: `tests/design-rules.test.mjs`

**Interfaces:**
- Produces a static guard against newly introduced forbidden utility patterns.

- [ ] **Step 1: Add a lightweight source scan**

Fail on touched files containing:

```text
font-bold
tracking-*
uppercase
body/control text-base or larger
emoji used as functional icons
new hard-coded hex colors outside DESIGN.md
an element combining border and shadow utilities
```

Allow documented exceptions only through an explicit allowlist with file and reason.

- [ ] **Step 2: Replace functional emoji with Lucide icons**

Start with lineage info cards and private-data lock indicators.

- [ ] **Step 3: Normalize setup-page colors**

Replace indigo/teal/red tokens with the existing primary, secondary, tertiary, neutral, surface, and border palette.

- [ ] **Step 4: Remove border-plus-shadow conflicts in touched components**

Choose one definition mechanism per surface. Preserve focus rings.

### Task 9: Verify responsive behavior on real viewport sizes

**Files:**
- Create: `tests/e2e/responsive.spec.ts`
- Modify: `playwright.config.ts`
- Modify: affected components only when tests expose failures

**Interfaces:**
- Produces repeatable viewport checks for small phone, large phone, tablet portrait, tablet landscape, and desktop.

- [ ] **Step 1: Add the responsive project to Playwright configuration**

Reuse Chromium installed in Phase 2. Add named projects for the five viewport sizes; do not install additional browsers.

- [ ] **Step 2: Test critical layouts**

Viewport matrix:

```text
375x667
430x932
768x1024
1024x768
1440x900
```

Cover login, member list, member form, detail modal, tree toolbar, gallery modal, activity history, and review page.

- [ ] **Step 3: Assert functional layout conditions**

```text
no horizontal page overflow except the intentional tree canvas
fixed controls do not cover content
dialogs fit and scroll internally
touch targets are at least 44x44 CSS pixels
tree toolbar remains reachable
text does not clip at 200% zoom
```

- [ ] **Step 4: Save screenshots only as CI artifacts**

Do not commit generated screenshots. Local screenshots belong in `tmp/`; CI screenshots upload only on failure.

### Task 10: Complete Phase 3 verification

**Files:**
- Create: `docs/releases/2026-09-phase-3-product.md`

- [ ] **Step 1: Run all checks**

```powershell
supabase db reset
supabase test db
bun run lint
bun run typecheck
bun run test:run
bunx playwright test
bun run build
git diff --check
```

- [ ] **Step 2: Perform role acceptance tests**

Verify admin, editor, member, inactive, and anonymous behavior for audit history, citations, privacy, change requests, and hidden people.

- [ ] **Step 3: Confirm Phase 3 release gate**

```text
all relevant changes produce immutable audit entries
supported undo detects conflicts
persons can cite sources
merges are explicit and atomic
privacy is enforced by RLS and UI
member proposals require review
dialogs and primary controls are keyboard accessible
critical pages pass responsive viewport checks
```
