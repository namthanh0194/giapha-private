'use server'

import { getIsAdmin } from '@/utils/supabase/queries'
import { toPublicError } from '@/utils/errors'
import { withTelemetry } from '@/utils/telemetry'
import {
  MIGRATION_CATALOG,
  readMigrationContent
} from '@/utils/migrations/catalog'
import packageJson from '@/package.json'
import postgres from 'postgres'
import path from 'node:path'

const SOURCE_REPOSITORY = 'homielab/giapha-os'
const SOURCE_BRANCH = 'main'
const SOURCE_README_URL = `https://github.com/${SOURCE_REPOSITORY}/blob/${SOURCE_BRANCH}/README.md#hướng-dẫn-cập-nhật-source-code`
const SOURCE_PACKAGE_URL = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_BRANCH}/package.json`

const MIGRATION_TABLE = 'public.app_migrations'

interface MigrationDefinition {
  id: string
  file: string
  sql: string
}

export interface MigrationStatus {
  configured: boolean
  databaseReachable: boolean
  error?: string
  errorId?: string
  source: SourceVersionStatus
  migrations: Array<{
    id: string
    file: string
    appliedAt: string | null
  }>
}

export type SourceVersionState = 'current' | 'outdated' | 'unknown'

export interface SourceVersionStatus {
  state: SourceVersionState
  currentVersion: string | null
  latestVersion: string | null
  readmeUrl: string
  error?: string
  errorId?: string
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== 'string') return null

  const match = value
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareVersions(left: ParsedVersion, right: ParsedVersion) {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }

  if (!left.prerelease.length && !right.prerelease.length) return 0
  if (!left.prerelease.length) return 1
  if (!right.prerelease.length) return -1

  const minLength = Math.min(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < minLength; i++) {
    const lPart = left.prerelease[i]
    const rPart = right.prerelease[i]
    const lNum = Number(lPart)
    const rNum = Number(rPart)
    const lIsNum = !Number.isNaN(lNum)
    const rIsNum = !Number.isNaN(rNum)

    if (lIsNum && rIsNum) {
      if (lNum !== rNum) return lNum > rNum ? 1 : -1
    } else if (lIsNum) {
      return -1
    } else if (rIsNum) {
      return 1
    } else if (lPart !== rPart) {
      return lPart.localeCompare(rPart) > 0 ? 1 : -1
    }
  }

  if (left.prerelease.length === right.prerelease.length) return 0
  return left.prerelease.length > right.prerelease.length ? 1 : -1
}

export async function getSourceVersionStatus(): Promise<SourceVersionStatus> {
  const currentVersion =
    typeof packageJson?.version === 'string' ? packageJson.version : null
  const parsedCurrent = parseVersion(currentVersion)

  try {
    const response = await fetch(SOURCE_PACKAGE_URL, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'giapha-os-migration-checker'
      }
    })

    if (!response.ok) {
      return {
        state: 'unknown',
        currentVersion,
        latestVersion: null,
        readmeUrl: SOURCE_README_URL,
        error: `Không thể kiểm tra version source code trên GitHub (HTTP ${response.status}).`
      }
    }

    const latestPackage = (await response.json()) as { version?: unknown }
    const latestVersion =
      typeof latestPackage?.version === 'string' ? latestPackage.version : null
    const parsedLatest = parseVersion(latestVersion)

    if (!parsedCurrent || !parsedLatest) {
      return {
        state: 'unknown',
        currentVersion,
        latestVersion,
        readmeUrl: SOURCE_README_URL,
        error:
          'Không xác định được version hợp lệ để so sánh giữa source local và GitHub.'
      }
    }

    const comparison = compareVersions(parsedCurrent, parsedLatest)
    if (comparison < 0) {
      return {
        state: 'outdated',
        currentVersion,
        latestVersion,
        readmeUrl: SOURCE_README_URL
      }
    }

    return {
      state: 'current',
      currentVersion,
      latestVersion,
      readmeUrl: SOURCE_README_URL
    }
  } catch (error) {
    const publicError = toPublicError(
      error,
      'Không thể kiểm tra version source code trên GitHub.',
      { event: 'migrations.source_check.failed' }
    )
    return {
      state: 'unknown',
      currentVersion,
      latestVersion: null,
      readmeUrl: SOURCE_README_URL,
      error: publicError.message,
      errorId: publicError.id
    }
  }
}

async function getMigrationDefinitions(): Promise<MigrationDefinition[]> {
  return Promise.all(
    MIGRATION_CATALOG.map(async (file) => ({
      id: path.basename(file, '.sql'),
      file,
      sql: await readMigrationContent(file)
    }))
  )
}

function createDatabaseClient() {
  const databaseUrl = process.env.SUPABASE_DB_URL
  if (!databaseUrl) return null

  return postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5
  })
}

async function ensureMigrationTable(sql: postgres.Sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      migration_id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE ${MIGRATION_TABLE} ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON ${MIGRATION_TABLE} FROM PUBLIC, anon, authenticated;
  `)
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const isAdmin = await getIsAdmin()
  const source = await getSourceVersionStatus()
  const definitions = await getMigrationDefinitions()

  if (!isAdmin) {
    return {
      configured: false,
      databaseReachable: false,
      error: 'Từ chối truy cập.',
      source,
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  }

  const sql = createDatabaseClient()
  if (!sql) {
    return {
      configured: false,
      databaseReachable: false,
      error: 'Chưa cấu hình SUPABASE_DB_URL trên server.',
      source,
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  }

  try {
    await ensureMigrationTable(sql)
    const rows = await sql.unsafe<
      Array<{
        migration_id: string
        applied_at: string
      }>
    >(
      `SELECT migration_id, applied_at FROM ${MIGRATION_TABLE} ORDER BY applied_at ASC`
    )
    const applied = new Map(
      rows.map((row) => [
        row.migration_id,
        new Date(row.applied_at).toISOString()
      ])
    )

    return {
      configured: true,
      databaseReachable: true,
      source,
      migrations: definitions.map((migration) => ({
        id: migration.id,
        file: migration.file,
        appliedAt: applied.get(migration.id) || null
      }))
    }
  } catch (error) {
    const publicError = toPublicError(
      error,
      'Không thể kết nối hoặc đọc trạng thái migration.',
      { event: 'migrations.status_read.failed' }
    )
    return {
      configured: true,
      databaseReachable: false,
      error: publicError.message,
      errorId: publicError.id,
      source,
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function runPendingMigrations() {
  return await withTelemetry('migrations.run_pending', { route: '/actions/migrations', roleClass: 'admin' }, async (scope) => {
  const isAdmin = await getIsAdmin()
  if (!isAdmin) return { success: false, error: 'Từ chối truy cập.' }

  const source = await getSourceVersionStatus()
  if (source.state !== 'current') {
    return {
      success: false,
      error:
        source.state === 'outdated'
          ? 'Source code chưa ở version mới nhất. Hãy cập nhật source code rồi thử lại.'
          : 'Không thể xác minh version source code. Migration đã bị tạm khóa.'
    }
  }

  const sql = createDatabaseClient()
  if (!sql) {
    return {
      success: false,
      error: 'Chưa cấu hình SUPABASE_DB_URL trên server.'
    }
  }

  try {
    const definitions = await getMigrationDefinitions()
    const result = await sql.begin(async (transaction) => {
      await transaction.unsafe(`
        CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
          migration_id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE ${MIGRATION_TABLE} ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON ${MIGRATION_TABLE} FROM PUBLIC, anon, authenticated;
        SELECT pg_advisory_xact_lock(hashtext('giapha_os_app_migrations'));
      `)

      const rows = await transaction.unsafe<
        Array<{ migration_id: string; applied_at: string }>
      >(`SELECT migration_id, applied_at FROM ${MIGRATION_TABLE}`)
      const applied = new Map(
        rows.map((row) => [row.migration_id, row.applied_at])
      )
      const appliedNow: string[] = []

      for (const migration of definitions) {
        if (applied.has(migration.id)) continue

        try {
          await transaction.unsafe(migration.sql)
          await transaction`
            INSERT INTO public.app_migrations (migration_id, file_name)
            VALUES (${migration.id}, ${migration.file})
            ON CONFLICT (migration_id) DO NOTHING
          `
          appliedNow.push(migration.file)
        } catch (error) {
          throw new Error(`Migration failed: ${migration.file}`, {
            cause: error
          })
        }
      }

      return appliedNow
    })

    scope.add({ rowCount: result.length })
    return {
      success: true,
      applied: result,
      message: result.length
        ? `Đã chạy ${result.length} migration.`
        : 'Database đã ở phiên bản mới nhất.'
    }
  } catch (error) {
    const fallback =
      error instanceof Error && error.message.startsWith('Migration failed:')
        ? `Không thể chạy ${error.message.replace('Migration failed: ', '')}.`
        : 'Không thể chạy migration. Kiểm tra SUPABASE_DB_URL và log server.'
    const publicError = toPublicError(error, fallback, {
      event: 'migrations.execution.failed'
    })
    return {
      success: false,
      error: publicError.message,
      errorId: publicError.id
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
  })
}
