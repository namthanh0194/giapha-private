# Phase 2 stabilization — 2026-09-02

## Delivered

- Added deterministic Vitest coverage and local Supabase database tests to the release workflow.
- Added pagination for dashboard reads and URL-backed member-list pagination.
- Added public error IDs, structured server logging, health/readiness endpoints, and storage/action compensation.
- Replaced direct Auth table changes with the Supabase Admin API and atomic admin-deletion reservations.
- Added dependency review automation and Chromium Playwright smoke coverage.
- Added `20260902110000_safe_restore_unconstrained_deletes.sql` so the transactional restore RPC remains compatible with safe-update enforcement.
- Added `20260902120000_public_readiness_rpc.sql` providing a zero-data `check_readiness()` RPC callable by anonymous health probes without hitting RLS-protected tables.
- Hardened E2E testing: unique `runId` scopes, exact ID/path cleanup tracking, and strict assertions that require 200 HTTP status from readiness probes.

## Verification run

Ran against a disposable local Supabase stack on 2026-09-02:

| Gate | Result |
| --- | --- |
| `supabase db reset` | Pass; applied all 11 migrations. |
| `supabase test db` | Pass; 7 files, 59 pgTAP tests. |
| `bun run test:run` | Pass; 8 files, 53 Vitest tests. |
| `node --test tests/migration-catalog.test.mjs tests/security-headers.test.mjs` | Pass; 2 tests. |
| `bun run typecheck` | Pass. |
| `bun run lint` | Pass. |
| `bun run build` | Pass; exit 0 with 21 static and dynamic routes compiled. |
| `bun run test:e2e` | Pass; Chromium, 5 serial critical-flow cases with exact fixture cleanup. |

The Chromium suite seeds scoped local users and 1,003 persons, then covers:

- `/api/health` (200) and `/api/readiness` (200 via `check_readiness()` RPC);
- email login; inactive-user approval screen; member read-only behavior;
- Admin API user creation; member-list page 1 and page 2; relationship creation;
- gallery upload/delete; JSON export; transactional restore and marker removal.

The E2E command requires `E2E_DISPOSABLE_LOCAL_SUPABASE=1`; CI resets its local database before the suite. This explicit guard prevents a backup-restore test from running against an unconfirmed local database.

## Known limitations

- Non-failing local warnings remain: Node's `MODULE_TYPELESS_PACKAGE_JSON`, `NO_COLOR`/`FORCE_COLOR` during Next development, and Next's LCP image advice.
- Playwright requires local Supabase environment variables from `supabase status -o env`; no production credentials or fixtures are used.
