# Phase 3 product improvements — 2026-09-03

## Delivered

- Task 1: Added append-only audit history and the activity dashboard.
- Task 2: Added conflict-aware undo for supported recent domain changes.
- Task 3: Added source records and person citations.
- Task 4: Added duplicate detection and explicit, atomic person-record merges.
- Task 5: Added record-level privacy for living people, enforced by RLS and UI.
- Task 6: Added review-before-publish workflow for member contributions.
- Task 7: Made affected dialogs and interactive controls keyboard accessible.
- Task 8: Brought Phase 3 UI work into `DESIGN.md` compliance.
- Task 9: Added real-viewport responsive Playwright coverage.
- Task 10: Completed release verification and these release notes.
- Restored safe-delete predicates in Phase 3 `restore_backup` definitions after critical E2E exposed Supabase safe-update rejection for unconditional DELETE statements.

## Verification run

Ran against a reset disposable local Supabase stack on 2026-09-03:

| Gate | Result |
| --- | --- |
| `supabase db reset` | Pass; applied all 18 migrations. |
| `supabase test db` | Pass; 13 files, 252 pgTAP tests. |
| `bun run test:run` | Pass; 14 files, 78 Vitest tests. |
| `bun run typecheck` | Pass. |
| `bun run lint` | Pass. |
| `bun run build` | Pass; Next.js generated 24 routes. |
| `bun run test:e2e -- tests/e2e/responsive.spec.ts` | Pass; 5 viewport checks passed, 20 nonmatching project cases skipped. |
| `bun run test:e2e -- tests/e2e/critical-flows.spec.ts` | Pass; 5 critical-flow checks passed. |

The E2E commands ran with `E2E_DISPOSABLE_LOCAL_SUPABASE=1` and local Supabase environment variables from `supabase status -o env`. Supplying the local variables avoids a Windows Bun nested-process build failure in the Playwright config while preserving the same disposable local stack and test behavior.

The critical suite covers health/readiness, inactive and read-only users, admin user and relationship management, gallery upload/delete, and backup export/restore. Responsive checks cover 375×667, 430×932, 768×1024, 1024×768, and 1440×900 viewports.

## Release gate

- Immutable audit entries are generated for relevant changes.
- Supported undo operations detect state conflicts.
- Persons can cite sources; duplicate merges are explicit and atomic.
- RLS and UI enforce privacy; member proposals require review.
- Dialogs and primary controls support keyboard interaction.
- Critical pages pass responsive viewport checks.

## Known limitations

- No release blockers.
- Non-failing local warnings remain: `NO_COLOR`/`FORCE_COLOR` during Next development and an intermittent Next destination-stream-close message after Playwright completes.