# Phase 4 Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support larger family datasets and reliable operations through lazy graph loading, indexed search, automated restore drills, optimistic concurrency, and measured observability—without adding infrastructure before evidence requires it.

**Architecture:** Keep PostgreSQL/Supabase as the system of record. Replace full-dataset browser hydration with bounded RPCs, add database-native indexes for Vietnamese name search, use scheduled operational jobs only for backups and verification, and introduce external telemetry through standard interfaces after consent and retention rules are defined.

**Tech Stack:** Next.js, Supabase PostgreSQL/RLS/Storage, `pg_trgm`, `unaccent`, OpenTelemetry OTLP/HTTP tracing, existing hosting platform monitoring, Vitest, pgTAP, Playwright, and a Node HTTP load script.

## Global Constraints

- Phase 1–3 release gates must pass.
- Scale work requires measured baseline data; do not optimize solely from intuition.
- Do not add Redis, a queue, read replicas, background workers, or microservices unless Task 6 decision gates are met.
- Preserve exact RLS/privacy behavior in every RPC and cache layer.
- Production backup credentials never pass through the browser.
- Load-test data must be fictional and generated in a disposable environment.
- Generated datasets, traces, screenshots, and benchmark output stay in `tmp/` or CI artifacts.
- Do not commit automatically.

---

### Task 1: Establish performance baselines and budgets

**Files:**
- Create: `tests/performance/dataset-generator.mjs`
- Create: `tests/performance/baseline.mjs`
- Create: `docs/performance-budgets.md`

**Interfaces:**
- Produces reproducible fictional datasets at 100, 1,000, 5,000, and 10,000 persons.
- Produces JSON benchmark output in `tmp/performance/`.

- [ ] **Step 1: Define supported dataset shapes**

Generate bounded family graphs with:

```text
one to eight generations
one or two biological parents
optional spouses
no cycles
10% adopted relationships
10% private persons
events and gallery metadata proportional to persons
```

- [ ] **Step 2: Define budgets before optimization**

Record initial targets:

```text
dashboard server response p95 <= 800 ms at 5,000 persons
member search p95 <= 300 ms
load direct family node p95 <= 300 ms
initial list HTML <= 500 KB uncompressed
initial tree payload <= 500 KB
browser interaction remains responsive on a mid-range mobile CPU
```

Budgets may be revised once baseline measurements exist, but changes require documented evidence.

- [ ] **Step 3: Add read-only benchmark scripts**

Measure dashboard, member list, search, kinship lookup, tree root load, gallery first page, and activity first page. Record status, response bytes, and elapsed time.

- [ ] **Step 4: Capture query plans**

For each database-heavy operation, save `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` output in `tmp/performance/`. Do not commit environment-specific plans.

### Task 2: Add bounded subtree and neighborhood RPCs

**Files:**
- Create: `supabase/migrations/20260904090000_family_graph_queries.sql`
- Create: `supabase/tests/database/family_graph_queries.test.sql`
- Create: `utils/supabase/family-graph.ts`
- Modify: `app/dashboard/members/page.tsx`
- Modify: `components/FamilyTree.tsx`
- Modify: `components/MindmapTree.tsx`

**Interfaces:**
- Produces RPC `public.get_family_subtree(root_id uuid, max_depth integer, include_spouses boolean) returns jsonb`.
- Produces RPC `public.get_person_neighborhood(person_id uuid, ancestor_depth integer, descendant_depth integer) returns jsonb`.

- [ ] **Step 1: Write graph query tests**

Cover roots, multiple spouses, adoption, privacy placeholders, maximum depth, cycles rejected by Phase 1, and missing IDs.

- [ ] **Step 2: Implement recursive CTE queries**

Enforce:

```text
max_depth allowlist 1..10
maximum 2,000 returned persons
maximum 6,000 returned relationships
privacy filtering equivalent to direct table RLS
stable deterministic ordering
```

Return `{ persons, relationships, truncated, maxDepth }`.

- [ ] **Step 3: Use an invoker-safe function**

Prefer `security invoker`. If `security definer` is required for privacy placeholders, schema-qualify all objects, set an empty search path, and reproduce access checks explicitly with tests.

- [ ] **Step 4: Replace initial full tree hydration**

Load only the selected root subtree. Keep list-view pagination from Phase 2 unchanged.

- [ ] **Step 5: Add “load more generations”**

Request the next bounded depth and merge nodes by ID. Do not refetch the complete graph.

- [ ] **Step 6: Verify payload budgets**

At 10,000 persons, initial tree response must remain under the documented payload budget or return `truncated: true` with usable UI guidance.

### Task 3: Add indexed Vietnamese name search

**Files:**
- Create: `supabase/migrations/20260904100000_person_search.sql`
- Create: `supabase/tests/database/person_search.test.sql`
- Create: `app/api/search/persons/route.ts`
- Modify: `components/PersonSelector.tsx`
- Modify: `components/MemberList.tsx`
- Modify: `components/RelationshipManager.tsx`

**Interfaces:**
- Produces normalized generated/search expression for `full_name` and `other_names`.
- Produces endpoint `/api/search/persons?q=&limit=` returning at most 20 safe person summaries.

- [ ] **Step 1: Verify extensions in the target Supabase version**

Confirm `pg_trgm` and `unaccent` availability using current Supabase documentation and `select * from pg_available_extensions` in staging.

- [ ] **Step 2: Write search behavior tests**

Cover:

```text
Vietnamese accents and accentless input
case insensitivity
prefix and substring match
other_names
private-person redaction
empty and one-character query rejection
stable ranking
```

- [ ] **Step 3: Add indexes**

Use a stored normalized expression and GIN trigram index. Do not apply functions to unindexed columns at query time without verifying the plan.

- [ ] **Step 4: Add a bounded search function or query**

Require query length 2..100, limit 1..20, and active user access. Return only ID, display name or privacy placeholder, gender, birth year when visible, and avatar path when visible.

- [ ] **Step 5: Replace repeated client `.ilike()` searches**

Debounce at 250–300 ms and cancel stale requests. Do not load recent/full person tables for selectors.

- [ ] **Step 6: Confirm index use**

At 10,000 persons, `EXPLAIN ANALYZE` must use the intended index for common queries and remain within the search budget.

### Task 4: Add optimistic concurrency control

**Files:**
- Create: `supabase/migrations/20260904110000_optimistic_concurrency.sql`
- Create: `supabase/tests/database/optimistic_concurrency.test.sql`
- Modify: `types/index.ts`
- Modify: `components/MemberForm.tsx`
- Modify: relevant Server Actions/RPCs
- Test: `tests/member-concurrency.test.ts`

**Interfaces:**
- Adds integer `version` columns to mutable domain tables, default 1.
- Mutations consume `expectedVersion` and return the next version.

- [ ] **Step 1: Add version columns and triggers**

Increment version only on actual updates. Include `persons`, `relationships`, `custom_events`, `gallery_items`, `sources`, and `person_citations`.

- [ ] **Step 2: Add conflict tests**

Two clients read version 3. Client A updates successfully to version 4. Client B updating with expected version 3 must fail without overwriting A.

- [ ] **Step 3: Update mutation contracts**

Every edit mutation must filter by ID and expected version or enforce the equivalent inside its RPC.

- [ ] **Step 4: Add conflict UX**

Show:

```text
Dữ liệu đã được người khác cập nhật.
Tải phiên bản mới
Xem thay đổi của bạn
```

Do not auto-merge arbitrary text or relationships.

- [ ] **Step 5: Connect audit history**

Link the conflict screen to relevant recent audit entries when the user has permission.

### Task 5: Automate encrypted backups and restore drills

**Files:**
- Create: `scripts/backup-database.mjs`
- Create: `scripts/verify-backup.mjs`
- Create: `docs/operations/backup-and-recovery.md`
- Create: `.github/workflows/restore-drill.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces encrypted PostgreSQL dump or provider-native backup reference.
- Produces a verification report containing timestamp, schema version, row counts, checksum, and restore result.

- [ ] **Step 1: Choose provider-native backup first**

Document Supabase daily backups/PITR availability for the deployed plan. Use `pg_dump` only when provider-native retention does not meet requirements.

- [ ] **Step 2: Define retention**

Initial recommendation:

```text
daily: 14 copies
weekly: 8 copies
monthly: 12 copies
```

Confirm storage cost and family privacy requirements before enabling production retention.

- [ ] **Step 3: Encrypt exports**

Use an operator-provided encryption key from the execution environment. Never store the key in the repository or in the backup artifact.

- [ ] **Step 4: Add verification without production mutation**

Restore the latest backup into an isolated Supabase branch or disposable local database, run migrations and DB tests, compare row counts/checksums, then destroy the temporary target.

- [ ] **Step 5: Schedule a monthly restore drill**

The workflow must require configured secrets and fail closed when they are absent. It must never target production for restore.

- [ ] **Step 6: Document RPO/RTO**

Record measured restore time and maximum data-loss window. Do not claim targets before a successful drill.

### Task 6: Add metrics, tracing, and error alerts

**Files:**
- Create: `instrumentation.ts`
- Create: `utils/telemetry.ts`
- Modify: critical Server Actions and Route Handlers
- Create: `docs/operations/observability.md`
- Test: `tests/telemetry.test.ts`

**Interfaces:**
- Produces server spans/metrics through OTLP/HTTP using `OTEL_EXPORTER_OTLP_ENDPOINT`; telemetry is a no-op when the variable is absent.

- [ ] **Step 1: Define data minimization rules**

Never send:

```text
person names
birth/death dates
phone numbers
residences
private notes
relationship notes
emails
approval tokens
backup contents
```

Allowed dimensions: route template, operation name, role class, status, duration, row count, payload bytes, error ID, app version.

- [ ] **Step 2: Instrument server-only critical paths**

Start with login callback, approval, restore, migrations, relationship RPC wrappers, search, subtree queries, gallery actions, and health/readiness.

- [ ] **Step 3: Add core metrics**

```text
request count and duration
RPC count and duration
restore success/failure
migration success/failure
approval success/failure
search latency
subtree rows and truncation
storage compensation failures
health/readiness status
```

- [ ] **Step 4: Configure alerts**

Alert only on actionable conditions: repeated restore failure, readiness failure, migration failure, elevated 5xx rate, or storage compensation failure.

- [ ] **Step 5: Verify redaction**

Automated tests inspect emitted telemetry objects and reject forbidden fields.

### Task 7: Add explicit scale decision gates

**Files:**
- Create: `docs/architecture/scale-decision-record.md`
- Modify: `docs/performance-budgets.md`

**Interfaces:**
- Produces documented thresholds for adding infrastructure.

- [ ] **Step 1: Define queue threshold**

Add a queue only when a measured user request performs work that cannot complete reliably within the platform timeout and cannot be reduced through batching or provider-native jobs.

- [ ] **Step 2: Define read-replica threshold**

Consider a read replica only when:

```text
read traffic dominates writes
indexed queries remain optimized
connection and CPU saturation are measured
stale-read behavior is acceptable
provider plan supports the operational cost
```

- [ ] **Step 3: Define cache threshold**

Add a shared cache only when repeated identical server queries remain a measured bottleneck after query/index optimization. Never cache user-specific/private payload without a proven tenant/user cache key and invalidation strategy.

- [ ] **Step 4: Define service split threshold**

Do not split the monolith for code organization alone. Require independent scaling, security boundary, or deployment lifecycle evidence.

### Task 8: Run load, privacy, and recovery acceptance tests

**Files:**
- Create: `tests/performance/load.mjs` or `tests/performance/load.js`
- Create: `docs/releases/2026-09-phase-4-scale.md`

- [ ] **Step 1: Implement the Node load runner**

Use Node's built-in `fetch`, `performance`, and worker/concurrency primitives. Accept base URL, concurrency, duration, and session cookie through command-line arguments or environment variables. Do not add k6 in this phase.

- [ ] **Step 2: Run staged load profiles**

Test 1, 5, 20, and 50 concurrent active users against fictional staging data. Cover list, search, subtree, detail, event, gallery, and activity endpoints.

- [ ] **Step 3: Verify privacy under load**

Mix admin/editor/member sessions and assert no private person, private audit payload, or admin-only data crosses role boundaries.

- [ ] **Step 4: Run restore drill**

Restore the newest encrypted backup to an isolated target, run schema/catalog checks and application smoke tests, record measured RPO/RTO, then destroy the target.

- [ ] **Step 5: Run the full verification suite**

```powershell
supabase db reset
supabase test db
bun run lint
bun run typecheck
bun run test:run
bunx playwright test
bun run build
node tests/performance/baseline.mjs
git diff --check
```

- [ ] **Step 6: Confirm Phase 4 release gate**

```text
initial tree load is bounded and lazy
Vietnamese search uses verified indexes
concurrent edits cannot silently overwrite
backup restore drill succeeds in isolation
telemetry contains no PII
performance budgets pass at the supported dataset size
no new infrastructure was added without a documented threshold breach
```
