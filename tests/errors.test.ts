import { afterEach, describe, expect, test, vi } from 'vitest'
import { createErrorId, toPublicError } from '@/utils/errors'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('public errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('creates a unique UUID error identifier', () => {
    const firstId = createErrorId()
    const secondId = createErrorId()

    expect(firstId).toMatch(UUID_PATTERN)
    expect(secondId).toMatch(UUID_PATTERN)
    expect(secondId).not.toBe(firstId)
  })

  test('logs the original error with its ID and returns only safe fields', () => {
    const originalEnv = process.env.SUPABASE_DB_URL
    process.env.SUPABASE_DB_URL =
      'postgresql://postgres:database-secret@localhost:5432/postgres'
    const error = new Error(
      'SELECT * FROM auth.users; https://example.com/callback?token=url-secret'
    )
    error.stack = 'Error: database-secret\n    at private/server/file.ts:42:7'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = toPublicError(error, 'Không thể hoàn tất thao tác.')
      const serializedResult = JSON.stringify(result)

      expect(result).toEqual({
        id: expect.stringMatching(UUID_PATTERN),
        message: 'Không thể hoàn tất thao tác.'
      })
      expect(Object.keys(result)).toEqual(['id', 'message'])
      expect(serializedResult).not.toContain('SELECT')
      expect(serializedResult).not.toContain('private/server/file.ts')
      expect(serializedResult).not.toContain('url-secret')
      expect(serializedResult).not.toContain('database-secret')
      expect(consoleError).toHaveBeenCalledOnce()
      const entry = JSON.parse(consoleError.mock.calls[0][0] as string)
      expect(entry).toMatchObject({
        level: 'error',
        event: 'server.operation.failed',
        fields: {
          errorId: result.id,
          error: {
            name: 'Error',
            message: expect.stringContaining('SELECT')
          }
        }
      })
      expect(JSON.stringify(entry)).not.toContain('url-secret')
      expect(JSON.stringify(entry)).not.toContain('database-secret')
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SUPABASE_DB_URL
      } else {
        process.env.SUPABASE_DB_URL = originalEnv
      }
    }
  })
})
