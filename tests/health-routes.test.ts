import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const ORIGINAL_ENV = process.env

describe('health and readiness route handlers', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    vi.restoreAllMocks()
  })

  test('health returns stable liveness JSON without caching', async () => {
    const { GET } = await import('@/app/api/health/route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok', version: '1.0.0' })
  })

  test('readiness returns ready when config and database are available', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = 'test-key'
    const abortSignal = vi.fn(async () => ({ data: true, error: null }))
    const rpc = vi.fn(() => ({ abortSignal }))
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        rpc
      }))
    }))

    const { GET } = await import('@/app/api/readiness/route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ready', database: 'connected' })
    expect(rpc).toHaveBeenCalledWith('check_readiness')
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  test('readiness returns generic 503 when public config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

    const { GET } = await import('@/app/api/readiness/route')
    const response = await GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'not_ready',
      reason: 'configuration_missing'
    })
  })

  test('readiness returns generic 503 without leaking database errors', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = 'test-key'
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        rpc: vi.fn(() => ({
          abortSignal: vi.fn(async () => ({
            data: null,
            error: { message: 'function check_readiness at postgresql://secret', code: '42883' }
          }))
        }))
      }))
    }))

    const { GET } = await import('@/app/api/readiness/route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({ status: 'not_ready', reason: 'database_unavailable' })
    expect(JSON.stringify(body)).not.toContain('postgresql://secret')
    expect(log).toHaveBeenCalled()
  })

  test('readiness returns 503 when the bounded query throws', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = 'test-key'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        rpc: vi.fn(() => ({
          abortSignal: vi.fn(async () => {
            throw new Error('AbortError')
          })
        }))
      }))
    }))

    const { GET } = await import('@/app/api/readiness/route')
    const response = await GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'not_ready',
      reason: 'database_unavailable'
    })
  })
})