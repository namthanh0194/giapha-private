import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATION_CATALOG } from '../utils/migrations/catalog.ts'

test('migration catalog matches sorted SQL files', () => {
  const actual = fs
    .readdirSync(path.resolve('supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => `supabase/migrations/${file}`)
  assert.deepEqual([...MIGRATION_CATALOG], actual)
})
