# Performance budgets

## Scope

These budgets apply to the supported fictional 5,000-person family graph. The graph has one to eight generations, bounded parent edges, optional spouses, 10% adopted relationships, 10% private persons, and proportional events and gallery metadata.

Run read-only baselines with:

```powershell
node tests/performance/dataset-generator.mjs --all
node tests/performance/baseline.mjs
```

`baseline.mjs` writes JSON only under `tmp/performance/`. Set `PERFORMANCE_BASE_URL` and optional authenticated `PERFORMANCE_COOKIE` for page measurements. When `SUPABASE_DB_URL` is set in the environment or `.env.local`, it also captures `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` in the report. Never commit files under `tmp/performance/`.

## Initial budgets

| Operation                    | Budget                               | Measurement                                                                  |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| Dashboard server response    | p95 <= 800 ms                        | `dashboard` elapsed time                                                     |
| Member search                | p95 <= 300 ms                        | `member-search` elapsed time                                                 |
| Direct family/tree root load | p95 <= 300 ms                        | `tree-root` elapsed time                                                     |
| Initial member list HTML     | <= 500 KB uncompressed               | `member-list` response bytes                                                 |
| Initial tree payload         | <= 500 KB                            | `tree-root` response bytes                                                   |
| Gallery/activity first page  | No regression from recorded baseline | `gallery-first-page` and `activity-first-page` p95                           |
| Mobile interaction           | Responsive on a mid-range mobile CPU | Manual browser trace: no long task >= 200 ms during initial tree interaction |

## Acceptance criteria

- Measure each probe at least five times against a warm, local or staging application seeded with the 5,000-person fixture.
- Use an authenticated member session for protected screens; a redirect or `401`/`403` is an invalid application measurement, not a passing result.
- Compare p95 values and uncompressed response bytes with the budgets above.
- Inspect generated query plans for sequential scans, row-estimate drift, and buffer growth before adding cache, queues, replicas, or service splits.
- Record environment, commit SHA, fixture size, run count, and any non-default cookie/URL outside version control with the JSON artifact.

## Revising a budget

A budget may change only after an initial baseline exists. The revision record must include:

1. The previous and proposed value, measured p95/bytes, fixture size, run count, and environment date.
2. The matching `tmp/performance/baseline-report.json` and relevant query plan evidence.
3. The user-visible reason for the change and alternatives considered, including query/index optimization first.
4. Approval in the release or architecture record before changing this document.

Do not relax a budget solely because a new feature is slower. Raise the supported-data-size target, optimize the measured query/payload, or document a product requirement that justifies the revision.

## Infrastructure decision gates

Infrastructure is not a substitute for an unmeasured or unindexed query. The threshold and evidence requirements are maintained in `docs/architecture/scale-decision-record.md`.

Before proposing a queue, read replica, shared cache, or service split, attach the current baseline artifact, query plans, capacity data, privacy impact, and rollback plan. A single slow run does not qualify; the degradation must be reproducible at the supported dataset size.
