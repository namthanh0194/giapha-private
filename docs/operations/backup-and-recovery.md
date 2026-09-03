# Backup and Disaster Recovery Runbook

## Overview

This runbook defines backup generation, encryption, retention policies, and isolated restore drill procedures for the genealogy database.

The system adheres to three non-negotiable operational principles:
1. **Provider-native backup first**: Prefer managed daily backups and Point-In-Time-Recovery (PITR) provided by Supabase.
2. **Encrypted offline snapshots**: Offsite exports are encrypted in-stream with AES-256-GCM before writing to storage. Plaintext SQL dumps are never written to disk.
3. **Verified isolated drills**: Restores are executed exclusively against disposable, isolated database instances. Production is never targeted or mutated during drills.

---

## 1. Provider-Native Backup Strategy

Supabase backup and PITR availability is plan-specific and can change. Before enabling this process for production, the operator must record the deployed plan, its automated-backup retention, and PITR availability from the current Supabase Dashboard or official documentation.

### Usage Guidance
- Production operational incident recovery within the provider SLA should use the Supabase Dashboard PITR / Snapshot restore workflow first.
- Scripted external dumps (`scripts/backup-database.mjs`) exist to satisfy offsite archival requirements, provider independence, and reproducible automated drills.
- To produce an auditable provider-native backup marker:
  ```bash
  node scripts/backup-database.mjs --native --out-dir tmp/backups
  ```

---

## 2. Retention Policy

Recommended baseline retention matrix:
- **Daily snapshots**: Retain **14 copies** (covers 2 weeks of fast incident detection).
- **Weekly snapshots**: Retain **8 copies** (covers 2 calendar months).
- **Monthly snapshots**: Retain **12 copies** (covers 1 calendar year of genealogical revision history).

> **Storage & Privacy Notice:** Before enabling indefinite or extended retention, confirm storage quotas and adhere to Vietnamese family privacy agreements. Older archives must be securely purged when superseded.

---

## 3. Encryption Standard & Fail-Closed Guard

- **Algorithm**: `AES-256-GCM` with authenticated 128-bit authentication tag and a unique 96-bit random IV per backup.
- **Secret Management**: Driven solely by the `BACKUP_ENCRYPTION_KEY` environment variable.
- **Fail-Closed**: If `BACKUP_ENCRYPTION_KEY` is missing or empty, scripts immediately abort with a non-zero exit code.
- **Zero Plaintext Footprint**: Output is streamed directly from `pg_dump` through the cryptographic cipher to disk (`.sql.enc`). No unencrypted intermediate files or credentials are persisted.
- **Artifacts Location**: Output files and verification reports default to `tmp/backups/` and are excluded by `.gitignore`.

---

## 4. Measured Recovery Objectives (RPO & RTO)

Per Phase 4 Task 5 constraints:
- **Target RPO (Recovery Point Objective)**: Measured only after a successful restore drill. Cannot be claimed a priori.
- **Target RTO (Recovery Time Objective)**: Measured only after a successful restore drill based on actual duration logged in verification reports.
- **Latest Drill Measurements**:
  - Drill Date: *Pending initial production drill completion*
  - Measured Duration (RTO): *Recorded in verify-report.json (`restoreResult.durationMs`)*
  - Observed Data Gap (RPO): *Calculated between source snapshot timestamp and verification completion*

---

## 5. Step-by-Step Recovery Procedures

### Scenario A: Automated Monthly Drill (CI/CD)
1. Workflow `.github/workflows/restore-drill.yml` executes on the 1st of every month at 03:00 UTC (`0 3 1 * *`).
2. Requires secrets `BACKUP_ENCRYPTION_KEY` and `BACKUP_SOURCE_DB_URL`. If either is missing, the job fails closed.
3. Starts an isolated local Supabase instance on the runner.
4. Generates an encrypted stream from source, then streams decrypted SQL directly into `psql` against the local database via memory pipes.
5. Verifies schema migrations and table row count parity.
6. Publishes a summary report to `$GITHUB_STEP_SUMMARY` and halts the container without residual state.

### Scenario B: Manual Emergency Recovery to Isolated Staging
1. Obtain the encrypted backup artifact (`backup-<timestamp>.sql.enc`) and the associated metadata (`backup-<timestamp>.sql.enc.meta.json`).
2. Provision a clean staging database (e.g. `isolated_recovery_drill`).
3. Set execution environment variables:
   ```bash
   export BACKUP_ENCRYPTION_KEY="<production-backup-key>"
   export RESTORE_TARGET_DB_URL="postgresql://postgres:password@isolated-host:5432/isolated_recovery_drill"
   export RESTORE_TARGET_CONFIRMATION="ISOLATED_RESTORE_ONLY"
   export PRODUCTION_DB_URL="postgresql://postgres:password@prod-host:5432/postgres"
   ```
4. Run the verification script:
   ```bash
   node scripts/verify-backup.mjs --file tmp/backups/backup-<timestamp>.sql.enc
   ```
5. Check JSON output report:
   - Confirm `restoreResult.status` is `"success"`.
   - Confirm `rowCounts.verified` is `true`.
   - Confirm `restoreResult.durationMs` satisfies operational downtime limits.
6. Perform smoke tests with application services pointed to the isolated staging instance.
