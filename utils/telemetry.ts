import packageJson from '@/package.json'

type RoleClass = 'admin' | 'editor' | 'member' | 'anonymous' | 'system' | 'unknown'

export type TelemetryDimensions = {
  route?: string
  roleClass?: RoleClass
  status?: number
  durationMs?: number
  rowCount?: number
  payloadBytes?: number
  errorId?: string
  appVersion?: string
  truncated?: boolean
}

type TelemetryScope = {
  add: (dimensions: TelemetryDimensions) => void
}

const ROLE_CLASSES = new Set<RoleClass>([
  'admin',
  'editor',
  'member',
  'anonymous',
  'system',
  'unknown'
])
const OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const ROUTE_PATTERN = /^\/(?:[a-z0-9._-]+(?:\/\[[a-zA-Z]+\]|\/[a-z0-9._-]+)*)?$/
const ERROR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VERSION_PATTERN = /^[0-9A-Za-z._+-]{1,64}$/
const EXPORT_TIMEOUT_MS = 750

function telemetryEndpoint(): string | null {
  const configured = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!configured) return null

  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.pathname.endsWith('/v1/traces')
      ? url.toString()
      : `${url.toString().replace(/\/$/, '')}/v1/traces`
  } catch {
    return null
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined
}

type OTLPAttribute =
  | { key: string; value: { stringValue: string } }
  | { key: string; value: { intValue: number } }
  | { key: string; value: { boolValue: boolean } }

function stringAttribute(key: string, value: string) {
  return { key, value: { stringValue: value } }
}

function intAttribute(key: string, value: number) {
  return { key, value: { intValue: value } }
}

function boolAttribute(key: string, value: boolean) {
  return { key, value: { boolValue: value } }
}

function attributesFor(operation: string, dimensions: TelemetryDimensions) {
  const attributes: OTLPAttribute[] = [stringAttribute('app.operation', OPERATION_PATTERN.test(operation) ? operation : 'app.operation.invalid')]
  if (dimensions.route && ROUTE_PATTERN.test(dimensions.route)) attributes.push(stringAttribute('app.route', dimensions.route))
  if (dimensions.roleClass && ROLE_CLASSES.has(dimensions.roleClass)) attributes.push(stringAttribute('app.role_class', dimensions.roleClass))
  if (typeof dimensions.status === 'number' && dimensions.status >= 100 && dimensions.status <= 599) attributes.push(intAttribute('http.response.status_code', dimensions.status))
  for (const [key, value] of [
    ['app.duration_ms', dimensions.durationMs],
    ['app.row_count', dimensions.rowCount],
    ['app.payload_bytes', dimensions.payloadBytes]
  ] as const) {
    const safeValue = numberValue(value)
    if (safeValue !== undefined) attributes.push(intAttribute(key, safeValue))
  }
  if (dimensions.errorId && ERROR_ID_PATTERN.test(dimensions.errorId)) attributes.push(stringAttribute('app.error_id', dimensions.errorId))
  const appVersion = dimensions.appVersion ?? packageJson.version
  if (VERSION_PATTERN.test(appVersion)) attributes.push(stringAttribute('service.version', appVersion))
  if (typeof dimensions.truncated === 'boolean') attributes.push(boolAttribute('app.truncated', dimensions.truncated))
  return attributes
}

function randomHex(length: number) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length)
}

function inferStatus(value: unknown): number {
  if (value instanceof Response) return value.status
  if (value && typeof value === 'object' && 'success' in value) {
    const result = value as { success?: unknown; errorId?: unknown }
    return result.success === true ? 200 : typeof result.errorId === 'string' ? 500 : 400
  }
  return 200
}

function runNonBlocking(task: () => Promise<void>) {
  try {
    void Promise.resolve()
      .then(task)
      .catch(() => {
        // ponytail: exporter retries belong in the collector once delivery reliability is required.
      })
  } catch {
    // Ignore sync failures during task initiation to keep caller isolated.
  }
}

export async function emitTelemetry(operation: string, dimensions: TelemetryDimensions = {}) {
  const endpoint = telemetryEndpoint()
  if (!endpoint) return

  const now = BigInt(Date.now()) * BigInt(1000000)
  const body = JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttribute('service.name', 'giapha-os'),
            stringAttribute('service.version', packageJson.version)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'giapha.telemetry' },
            spans: [
              {
                traceId: randomHex(32),
                spanId: randomHex(16),
                name: OPERATION_PATTERN.test(operation) ? operation : 'app.operation.invalid',
                kind: 1,
                startTimeUnixNano: now.toString(),
                endTimeUnixNano: now.toString(),
                attributes: attributesFor(operation, dimensions)
              }
            ]
          }
        ]
      }
    ]
  })

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS)
    })
  } catch {
    // ponytail: exporter retries belong in the collector once delivery reliability is required.
  }
}

export async function withTelemetry<T>(
  operation: string,
  dimensions: TelemetryDimensions,
  callback: (scope: TelemetryScope) => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  const additions: TelemetryDimensions = {}
  const scope: TelemetryScope = {
    add: (next) => Object.assign(additions, next)
  }

  try {
    const result = await callback(scope)
    runNonBlocking(async () => {
      await emitTelemetry(operation, {
        ...dimensions,
        ...additions,
        status: additions.status ?? dimensions.status ?? inferStatus(result),
        durationMs: performance.now() - startedAt
      })
    })
    return result
  } catch (error) {
    runNonBlocking(async () => {
      await emitTelemetry(operation, {
        ...dimensions,
        ...additions,
        status: additions.status ?? dimensions.status ?? 500,
        durationMs: performance.now() - startedAt
      })
    })
    throw error
  }
}

export function registerTelemetry() {
  telemetryEndpoint()
}
