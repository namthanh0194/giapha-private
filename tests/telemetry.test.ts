import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const ORIGINAL_ENV = process.env

describe('server telemetry', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    vi.restoreAllMocks()
  })

  test('is a no-op when no OTLP endpoint is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { emitTelemetry } = await import('@/utils/telemetry')

    await emitTelemetry('search.persons', { route: '/api/search/persons', status: 200 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('emits only permitted dimensions in an OTLP span', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const { emitTelemetry } = await import('@/utils/telemetry')

    await emitTelemetry('search.persons', {
      route: '/api/search/persons',
      roleClass: 'member',
      status: 200,
      durationMs: 12,
      rowCount: 3,
      payloadBytes: 256,
      errorId: '81ad8ab6-ec20-45bd-8e5d-93b6d91dc256',
      appVersion: '1.0.0',
      truncated: false
    })

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const attributes = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes
    const values = Object.fromEntries(
      attributes.map((attribute: { key: string; value: Record<string, unknown> }) => [
        attribute.key,
        Object.values(attribute.value)[0]
      ])
    )

    expect(fetchMock.mock.calls[0][0]).toBe('https://otel.example/v1/traces')
    expect(values).toMatchObject({
      'app.route': '/api/search/persons',
      'app.role_class': 'member',
      'http.response.status_code': 200,
      'app.duration_ms': 12,
      'app.row_count': 3,
      'app.payload_bytes': 256,
      'app.error_id': '81ad8ab6-ec20-45bd-8e5d-93b6d91dc256',
      'service.version': '1.0.0',
      'app.truncated': false
    })
  })

  test('rejects forbidden fields instead of exporting PII', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example/v1/traces'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const { emitTelemetry } = await import('@/utils/telemetry')

    await emitTelemetry('restore.backup', {
      route: '/dashboard/data',
      status: 500,
      fullName: 'Nguyễn Văn An',
      birthDate: '1940-01-01',
      phone: '0900000000',
      residence: 'Hà Nội',
      note: 'private family note',
      email: 'member@example.com',
      token: 'secret-token',
      backupContent: 'backup-data'
    } as unknown as Parameters<typeof emitTelemetry>[1])

    const serialized = String(fetchMock.mock.calls[0][1]?.body)
    expect(serialized).not.toContain('Nguyễn Văn An')
    expect(serialized).not.toContain('1940-01-01')
    expect(serialized).not.toContain('0900000000')
    expect(serialized).not.toContain('Hà Nội')
    expect(serialized).not.toContain('private family note')
    expect(serialized).not.toContain('member@example.com')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('backupContent')
  })

  test('swallows exporter failures', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('collector unavailable'))
    const { emitTelemetry } = await import('@/utils/telemetry')

    await expect(
      emitTelemetry('health.readiness', { route: '/api/readiness', status: 503 })
    ).resolves.toBeUndefined()
  })

  test('keeps callers isolated when telemetry construction rejects', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example'
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('random source unavailable')
    })
    const { withTelemetry } = await import('@/utils/telemetry')

    await expect(
      withTelemetry('health.readiness', { route: '/api/readiness' }, async () => ({
        success: true
      }))
    ).resolves.toEqual({ success: true })
  })

  test('instruments critical paths with route templates, not approval tokens', async () => {
    const files = await import('node:fs/promises')
    const expectations = [
      ['app/auth/callback/route.ts', "withTelemetry('auth.callback'", "route: '/auth/callback'"],
      ['app/api/admin/approve/[token]/route.ts', "withTelemetry('admin.approval_view'", "route: '/api/admin/approve/[token]'"],
      ['app/api/admin/approve/[token]/route.ts', "withTelemetry('admin.approval_submit'", "route: '/api/admin/approve/[token]'"],
      ['app/actions/migrations.ts', "withTelemetry('migrations.run_pending'", "route: '/actions/migrations'"],
      ['app/actions/member.ts', "withTelemetry('member.update'", "route: '/actions/member'"],
      ['app/actions/member.ts', "withTelemetry('member.delete'", "route: '/actions/member'"],
      ['app/actions/member.ts', "withTelemetry('member.update_descendant_generations'", "route: '/actions/member'"],
      ['app/actions/member.ts', "withTelemetry('relationship.delete'", "route: '/actions/member'"],
      ['app/actions/member.ts', "withTelemetry('member.create_spouse'", "route: '/actions/member'"],
      ['app/actions/member.ts', "withTelemetry('member.create_children'", "route: '/actions/member'"]
    ] as const

    for (const [path, operation, route] of expectations) {
      const source = await files.readFile(path, 'utf8')
      expect(source).toContain(operation)
      expect(source).toContain(route)
    }
  })

  test('has no browser telemetry entry point', async () => {
    const files = await import('node:fs/promises')

    await expect(files.access('instrumentation-client.ts')).rejects.toThrow()
  })
})
