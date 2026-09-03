# Scale decision record

## Decision

As of September 3, 2026, the application remains a Next.js monolith backed by Supabase PostgreSQL. It does not add Redis, a queue, read replica, background-worker fleet, or microservice solely for anticipated growth.

Any proposal must include a recent, reproducible `tmp/performance/` baseline, relevant query plan or runtime evidence, privacy review, operating-cost estimate, and an explicit rollback plan.

## Decision gates

| Capability | Add only when all evidence is present | Required safeguards |
| --- | --- | --- |
| Queue | A measured user request exceeds the platform timeout under supported load, and batching, database optimization, and provider-native jobs cannot make it reliable. | Idempotency key, retry cap, dead-letter handling, operator visibility, and no PII in payload/logs. |
| Read replica | Read traffic dominates writes; indexed queries remain optimized; CPU, connection, and primary-read saturation are measured; stale-read behavior is acceptable; provider plan cost is approved. | Route only safe read paths, document replication lag, keep privacy/RLS behavior identical, and provide a primary fallback. |
| Shared cache | Repeated identical server queries remain a measured bottleneck after query/index optimization. | Never cache user-specific/private payload without a proven role/user key, TTL, invalidation strategy, and redaction test. |
| Service split | There is evidence for independent scaling, a security boundary, or a distinct deployment lifecycle. Code organization alone is insufficient. | Contract tests, ownership, observability, migration strategy, and a rollback plan. |

## Review cadence

Review these gates after a measured 5,000-person baseline, after any repeated operational alert, and before increasing the supported dataset target. A threshold breach starts an architecture review; it does not automatically authorize infrastructure.
