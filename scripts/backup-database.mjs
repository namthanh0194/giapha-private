#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_MAGIC = 'GIAPHA_ENC_V1';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

export function resolveKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length === 0) {
    throw new Error('BACKUP_ENCRYPTION_KEY is required and must not be empty.');
  }
  const trimmed = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  try {
    const b64 = Buffer.from(trimmed, 'base64');
    if (b64.length === 32) return b64;
  } catch {}
  if (Buffer.byteLength(trimmed, 'utf8') === 32) return Buffer.from(trimmed, 'utf8');
  // ponytail: derives 32 bytes via sha256 when arbitrary passphrase is provided. Upgrade path: enforce strict 256-bit hex/base64 key.
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export function encryptBuffer(buffer, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.from(HEADER_MAGIC, 'utf8');
  const headerLen = Buffer.alloc(2);
  headerLen.writeUInt16BE(header.length, 0);
  return Buffer.concat([headerLen, header, iv, encrypted, tag]);
}

export function decryptBuffer(payload, key) {
  if (payload.length < 2) throw new Error('Payload too small: missing header length.');
  const headerLen = payload.readUInt16BE(0);
  const headerEnd = 2 + headerLen;
  if (payload.length < headerEnd + IV_LENGTH + TAG_LENGTH) throw new Error('Payload corrupted or truncated.');
  const magic = payload.subarray(2, headerEnd).toString('utf8');
  if (magic !== HEADER_MAGIC) throw new Error(`Unsupported backup format/magic: ${magic}`);
  const iv = payload.subarray(headerEnd, headerEnd + IV_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(headerEnd + IV_LENGTH, payload.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function runSelfTest() {
  const original = Buffer.from(JSON.stringify({ test: 'giapha-backup-sample', timestamp: new Date().toISOString() }), 'utf8');
  const encrypted = encryptBuffer(original, resolveKey('test-secret-key-that-will-be-hashed-32bytes'));
  if (encrypted.includes(Buffer.from('giapha-backup-sample'))) throw new Error('Self-test failed: plaintext leaked into encrypted payload.');
  if (!decryptBuffer(encrypted, resolveKey('test-secret-key-that-will-be-hashed-32bytes')).equals(original)) {
    throw new Error('Self-test failed: decrypted content mismatch.');
  }
  try {
    decryptBuffer(encrypted, resolveKey('different-test-secret-key-value'));
  } catch {
    return { status: 'pass', originalBytes: original.length, encryptedBytes: encrypted.length };
  }
  throw new Error('Self-test failed: wrong key did not fail closed.');
}

function getRowCounts(dbUrl) {
  try {
    const output = execFileSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--dbname', dbUrl, '--command', ROW_COUNTS_SQL], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return JSON.parse(output || '{}');
  } catch (error) {
    throw new Error(`Cannot collect database row counts with psql: ${error.message}`);
  }
}

async function getSchemaVersion() {
  const migrationDir = path.join(REPOSITORY_ROOT, 'supabase', 'migrations');
  const migrations = (await fs.readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
  if (migrations.length === 0) throw new Error('No Supabase migration files found for schema version.');
  return migrations.at(-1).replace(/\.sql$/, '');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    console.log(JSON.stringify({ backup_self_test: await runSelfTest() }, null, 2));
    return;
  }

  const rawKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!rawKey || !rawKey.trim()) throw new Error('BACKUP_ENCRYPTION_KEY environment variable is required and must not be empty.');
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('Database connection URL is missing (SUPABASE_DB_URL or DATABASE_URL).');

  const outDirIndex = args.indexOf('--out-dir');
  const outDir = outDirIndex !== -1 && args[outDirIndex + 1] ? args[outDirIndex + 1] : 'tmp/backups';
  await fs.mkdir(outDir, { recursive: true });

  if (args.includes('--native') || args.includes('--provider-native')) {
    const reference = {
      timestamp: new Date().toISOString(),
      type: 'provider-native-reference',
      provider: 'supabase',
      note: 'Confirm daily backup and PITR availability against the deployed Supabase plan before relying on this reference.'
    };
    const referencePath = path.join(outDir, 'backup-ref-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    await fs.writeFile(referencePath, JSON.stringify(reference, null, 2), 'utf8');
    console.log(JSON.stringify({ status: 'success', ...reference, file: path.basename(referencePath) }, null, 2));
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpFileEncrypted = path.join(outDir, `backup-${timestamp}.sql.enc`);
  const sourceRowCounts = getRowCounts(dbUrl);
  const schemaVersion = await getSchemaVersion();
  const key = resolveKey(rawKey);

  const metadata = await new Promise((resolve, reject) => {
    const proc = spawn('pg_dump', ['--no-owner', '--no-privileges', '--clean', '--if-exists', dbUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errOutput = '';
    const dumpChecksum = createHash('sha256');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const header = Buffer.from(HEADER_MAGIC, 'utf8');
    const headerLen = Buffer.alloc(2);
    headerLen.writeUInt16BE(header.length, 0);
    const output = createWriteStream(dumpFileEncrypted, { flags: 'wx' });

    proc.stdout.on('data', (chunk) => dumpChecksum.update(chunk));
    proc.stderr.on('data', (chunk) => (errOutput += chunk.toString()));
    proc.once('error', (error) => reject(new Error(`Failed to execute pg_dump: ${error.message}. Check PostgreSQL client tools are installed.`)));
    output.once('error', reject);
    output.write(Buffer.concat([headerLen, header, iv]));

    Promise.all([
      pipeline(proc.stdout, cipher, output, { end: false }),
      new Promise((resolveProcess, rejectProcess) => proc.once('close', (code) => {
        if (code === 0) resolveProcess();
        else rejectProcess(new Error(`pg_dump exited with code ${code}: ${errOutput}`));
      }))
    ])
      .then(async () => {
        output.end(cipher.getAuthTag());
        await new Promise((resolveOutput, rejectOutput) => {
          output.once('finish', resolveOutput);
          output.once('error', rejectOutput);
        });
        const stat = await fs.stat(dumpFileEncrypted);
        resolve({
          timestamp: new Date().toISOString(),
          schemaVersion,
          rowCounts: sourceRowCounts,
          format: 'pg_dump/plain/aes-256-gcm',
          dumpSha256: dumpChecksum.digest('hex'),
          sizeBytes: stat.size,
          file: path.basename(dumpFileEncrypted)
        });
      })
      .catch(reject);
  });

  await fs.writeFile(`${dumpFileEncrypted}.meta.json`, JSON.stringify(metadata, null, 2), 'utf8');
  console.log(JSON.stringify({ status: 'success', ...metadata }, null, 2));
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'error', message: error.message }, null, 2));
    process.exit(1);
  });
}
