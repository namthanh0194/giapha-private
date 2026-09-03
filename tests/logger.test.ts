import { afterEach, describe, expect, test, vi } from 'vitest'
import { logError, logInfo, logWarn } from '@/utils/logger'

describe('structured server logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test.each([ [ 'info', logInfo, 'info' ], [ 'warn', logWarn, 'warn' ] ] as const)(
    'writes a JSON %sSenvelope',
    (_name, log, consoleMethod) => {
      const output = vi
        .spyOn(console, consoleMethod)
        .mockImplementation(() => undefined)

      log(
        'member.updated',
        { memberId: 'person-1' },
        { requestId: 'request-1', userId: 'user-1' }
      )

      expect(output).toHaveBeenCalledOnce()
      const entry = JSON.parse(output.mock.calls[0][0] as string)
      expect(entry).toEqual({
        timestamp: expect.any(String),
        level: consoleMethod,
        event: 'member.updated',
        requestId: 'request-1',
        userId: 'user-1',
        fields: { memberId: 'person-1' }
      })
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN()
    }
  )

  test('redacts sensitive values recursively without mutating input', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const fields = {
      password: 'password-secret',
      nested: {
        token: 'token-secret',
        authorization: 'Bearer authorization-secret',
        phone_number: '0900000000',
        current_residence: 'private address',
        SUPABASE_DB_URL: 'postgresql://database-secret',
        service_role_key: 'service-secret',
        clientSecret: 'client-secret'
      },
      safe: 'visible'
    }

    logInfo('security.redaction', fields)

    const entry = JSON.parse(output.mock.calls[0][0] as string)
    expect(entry.fields).toEqual({
      password: '[REDACTED]',
      nested: {
        token: '[REDACTED]',
        authorization: '[REDACTED]',
        phone_number: '[REDACTED]',
        current_residence: '[REDACTED]',
        SUPABASE_DB_URL: '[REDACTED]',
        service_role_key: '[REDACTED]',
        clientSecret: '[REDACTED]'
      },
      safe: 'visible'
    })
    expect(fields.password).toBe('password-secret')
  })

  test('serializes errors inside redacted fields', () => {
    const output = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const error = new Error('Database request failed')

    logError(
      'database.failed',
      error,
      { authorization: 'Bearer secret', operation: 'restore_backup' },
      { requestId: 'request-2' }
    )

    const entry = JSON.parse(output.mock.calls[0][0] as string)
    expect(entry).toMatchObject({
      level: 'error',
      event: 'database.failed',
      requestId: 'request-2',
      fields: {
        authorization: '[REDACTED]',
        operation: 'restore_backup',
        error: {
          name: 'Error',
          message: 'Database request failed'
        }
      }
    })
  })

  test('handles circular references by replacing repeated references with [Circular]', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const circularObject: Record<string, unknown> = { name: 'root' }
    circularObject.self = circularObject
    circularObject.child = { parent: circularObject }

    logInfo('circular.event', { payload: circularObject })

    expect(output).toHaveBeenCalledOnce()
    const entry = JSON.parse(output.mock.calls[0][0] as string)
    expect(entry.fields).toEqual({
      payload: {
        name: 'root',
        self: '[Circular]',
        child: {
          parent: '[Circular]'
        }
      }
    })
  })

  test('redacts broad URL query secrets and database connection strings', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const queryUrl =
      'https://example.com/oauth/callback?access_token=token-1&refresh_token=refresh-1&client_secret=secret-1&apikey=api-key-1&api_key=api-key-2&key=key-1&secret=secret-2&safe=value'
    const dbUrl =
      'postgres://postgres:my-super-secret-password@db.example.supabase.co:5432/postgres?sslmode=require&apiKey=secret-key'

    logInfo('urls.redaction', {
      queryUrl,
      dbUrl,
      note: 'Connecting with postgresql://user:pass@host:5432/db and param key=my-key'
    })

    const entry = JSON.parse(output.mock.calls[0][0] as string)
    expect(entry.fields.queryUrl).toBe(
      'https://example.com/oauth/callback?access_token=[REDACTED]&refresh_token=[REDACTED]&client_secret=[REDACTED]&apikey=[REDACTED]&api_key=[REDACTED]&key=[REDACTED]&secret=[REDACTED]&safe=value'
    )
    expect(entry.fields.dbUrl).toBe('[REDACTED]')
    expect(entry.fields.note).toBe(
      'Connecting with [REDACTED] and param key=[REDACTED]'
    )
  })
})
