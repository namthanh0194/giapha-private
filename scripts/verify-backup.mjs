#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBuffer, encryptBuffer, resolveKey } from './backup-database.mjs';

const ROW_COUNTS_SQL = `
  SELECT COALESCE(jsonb_object_agg(table_name, row_count ORDER BY table_name), '{}'::jsonb)
  FROM (
    SELECT table_name,
      (xpath('/row/count/text()', query_to_xml(
        format('SELECT count(*) AS count FROM %I.%I', table_schema, table_name),
        false, true, ''
      )))[1]::text::bigint AS row_count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ) AS counts;
`;

export function assertSafeRestoreTarget(targetUrl, forbiddenUrls = []) {
  if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
    throw new Error('Target database URL is required.');
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    throw new Error('Target database URL is not a valid URL.');
  }

  // Fail closed if explicitly matching production URLs
  for (const forbidden of forbiddenUrls) {
    if (!forbidden) continue;
    try {
      const parsedForbidden = new URL(forbidden);
      if (
        parsedTarget.hostname === parsedForbidden.hostname &&
        parsedTarget.port === parsedForbidden.port &&
        parsedTarget.pathname === parsedForbidden.pathname
      ) {
        throw new Error('Safety guard: restore target points directly to production/source database URL.');
      }
    } catch (e) {
      if (e.message.startsWith('Safety guard:')) throw e;
    }
  }

  const hostname = parsedTarget.hostname.toLowerCase();
  const dbName = parsedTarget.pathname.replace(/^\//, '').toLowerCase();

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const isIsolatedNamed = ['isolated', 'drill', 'disposable', 'scratch', 'test', 'temp'].some(
    (prefix) => dbName.includes(prefix) || hostname.includes(prefix)
  );

  if (!isLocal && !isIsolatedNamed) {
    throw new Error(
      `Safety guard: restore target "${parsedTarget.hostname}/${dbName}" is not an isolated target. Database name or hostname must contain "isolated", "drill", "test", or be localhost.`
    );
  }
}

export function parseRowCounts(rawOutput) {
  try {
    return JSON.parse(rawOutput.trim() || '{}');
  } catch {
    return {};
  }
}

export function compareRowCounts(sourceCounts = {}, targetCounts = {}) {
  const allKeys = Array.from(new Set([...Object.keys(sourceCounts), ...Object.keys(targetCounts)])).sort();
  const diffs = {};
  let match = true;
  for (const key of allKeys) {
    const src = Number(sourceCounts[key] ?? 0);
    const tgt = Number(targetCounts[key] ?? 0);
    if (src !== tgt) {
      match = false;
      diffs[key] = { source: src, restored: tgt };
    }
  }
  return { match, diffs };
}

export async function runSelfTest() {
  // Test safety guard
  let caughtProd = false;
  try {
    assertSafeRestoreTarget('postgresql://postgres:postgres@db.production.supabase.co:5432/postgres', [
      'postgresql://postgres:postgres@db.production.supabase.co:5432/postgres'
    ]);
  } catch (err) {
    if (err.message.includes('Safety guard:')) caughtProd = true;
  }
  if (!caughtProd) throw new Error('Self-test failed: production restore target was not blocked.');

  // Test row count comparison
  const comp = compareRowCounts({ persons: 10, relationships: 5 }, { persons: 10, relationships: 5 });
  if (!comp.match) throw new Error('Self-test failed: equal row counts did not match.');

  const diffComp = compareRowCounts({ persons: 10 }, { persons: 9 });
  if (diffComp.match || !diffComp.diffs.persons) {
    throw new Error('Self-test failed: differing row counts were not detected.');
  }

  // Test decryption verification
  const key = resolveKey('test-secret-key-32-chars-long-abcdef');
  const dummyPayload = Buffer.from('CREATE TABLE test_verify (id int);', 'utf8');
  const encrypted = encryptBuffer(dummyPayload, key);
  const decrypted = decryptBuffer(encrypted, key);
  if (!decrypted.equals(dummyPayload)) {
    throw new Error('Self-test failed: decryption mismatch.');
  }

  return { status: 'pass', testsRun: 3 };
}

async function findLatestBackupFile(backupsDir) {
  try {
    const files = await fs.readdir(backupsDir);
    const encFiles = files.filter((f) => f.endsWith('.sql.enc')).sort().reverse();
    if (encFiles.length > 0) return path.join(backupsDir, encFiles[0]);
  } catch {}
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    const result = await runSelfTest();
    console.log(JSON.stringify({ verify_self_test: result }, null, 2));
    process.exit(0);
  }

  const rawKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!rawKey || !rawKey.trim()) {
    console.error(JSON.stringify({ status: 'error', message: 'BACKUP_ENCRYPTION_KEY environment variable is required.' }, null, 2));
    process.exit(1);
  }
  const key = resolveKey(rawKey);

  const targetDbUrl = process.env.RESTORE_TARGET_DB_URL || process.env.ISOLATED_DB_URL;
  if (!targetDbUrl) {
    console.error(JSON.stringify({ status: 'error', message: 'Target database URL is required (RESTORE_TARGET_DB_URL or ISOLATED_DB_URL).' }, null, 2));
    process.exit(1);
  }
  if (process.env.RESTORE_TARGET_CONFIRMATION !== 'ISOLATED_RESTORE_ONLY') {
    console.error(JSON.stringify({ status: 'error', message: 'RESTORE_TARGET_CONFIRMATION=ISOLATED_RESTORE_ONLY is required.' }, null, 2));
    process.exit(1);
  }

  const forbiddenUrls = [
    process.env.PRODUCTION_DB_URL,
    process.env.SUPABASE_DB_URL,
    process.env.DATABASE_URL
  ].filter(Boolean);

  assertSafeRestoreTarget(targetDbUrl, forbiddenUrls);

  const fileArgIndex = args.indexOf('--file');
  let backupFile = fileArgIndex !== -1 && args[fileArgIndex + 1] ? args[fileArgIndex + 1] : null;

  if (!backupFile) {
    backupFile = await findLatestBackupFile('tmp/backups');
  }

  if (!backupFile) {
    console.error(JSON.stringify({ status: 'error', message: 'No backup file specified or found in tmp/backups/.' }, null, 2));
    process.exit(1);
  }

  const encryptedBytes = await fs.readFile(backupFile);
  const checksum = createHash('sha256').update(encryptedBytes).digest('hex');
  const decryptedSql = decryptBuffer(encryptedBytes, key);

  let meta = {};
  try {
    const metaContent = await fs.readFile(`${backupFile}.meta.json`, 'utf8');
    meta = JSON.parse(metaContent);
  } catch {}

  const startTime = Date.now();

  // Restore into target isolated database without writing plaintext SQL to disk
  await new Promise((resolve, reject) => {
    const proc = spawn('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', targetDbUrl], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let errOutput = '';
    proc.stderr.on('data', (c) => (errOutput += c.toString()));
    proc.on('error', (err) => reject(new Error(`Failed to run psql: ${err.message}`)));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`psql restore exited with code ${code}: ${errOutput}`));
      }
      resolve();
    });

    proc.stdin.write(decryptedSql);
    proc.stdin.end();
  });

  const durationMs = Date.now() - startTime;

  // Collect row counts from target database
  let targetRowCounts = {};
  try {
    const countOutput = execFileSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--dbname', targetDbUrl, '--command', ROW_COUNTS_SQL], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    targetRowCounts = parseRowCounts(countOutput);
  } catch (e) {
    console.error(`Warning: Failed to fetch restored row counts: ${e.message}`);
  }

  // Collect schema version / migration info
  let restoredSchema = 'unknown';
  try {
    const schemaOutput = execFileSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--dbname', targetDbUrl, '--command', `SELECT COALESCE(max(version), 'none') FROM supabase_migrations.schema_migrations;`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    restoredSchema = schemaOutput || 'none';
  } catch {}

  const rowCountComparison = compareRowCounts(meta.rowCounts ?? {}, targetRowCounts);
  const verified = rowCountComparison.match;

  const report = {
    timestamp: new Date().toISOString(),
    schemaVersion: meta.schemaVersion ?? restoredSchema,
    checksum: {
      encryptedSha256: checksum,
      originalDumpSha256: meta.dumpSha256 ?? null
    },
    rowCounts: {
      source: meta.rowCounts ?? null,
      restored: targetRowCounts,
      verified,
      discrepancies: rowCountComparison.diffs
    },
    restoreResult: {
      status: verified ? 'success' : 'failed',
      durationMs,
      targetIsolated: true,
      backupFile: path.basename(backupFile)
    }
  };

  const reportPath = path.join('tmp', 'backups', `verify-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  if (!verified) process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  main().catch((err) => {
    console.error(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exit(1);
  });
}
