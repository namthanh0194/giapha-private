if (typeof window !== 'undefined') {
  throw new Error('utils/logger is a server-only module and must not be imported in browser code.')
}

type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?: string
  userId?: string
}

export type LogFields = Record<string, unknown>

interface LogEnvelope {
  timestamp: string
  level: LogLevel
  event: string
  requestId?: string
  userId?: string
  fields: LogFields
}

const REDACTED = '[REDACTED]'
const CIRCULAR = '[Circular]'

const SENSITIVE_QUERY_PARAMS = [
  'access_token',
  'api_key',
  'apikey',
  'authorization',
  'client_secret',
  'clientsecret',
  'current_residence',
  'key',
  'password',
  'phone_number',
  'refresh_token',
  'secret',
  'service_key',
  'service_role_key',
  'supabase_db_url',
  'token'
].join('|')

const URL_QUERY_SECRET_PATTERN = new RegExp(
  `([?&](?:(?:${SENSITIVE_QUERY_PARAMS}))=)[^&?#\\s]*`,
  'gi'
)

const KEY_VALUE_SECRET_PATTERN = new RegExp(
  `\\b(?:(?:${SENSITIVE_QUERY_PARAMS}))\\s*[=:]\\s*[^\\s,;&?#]+`,
  'gi'
)
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()

  return (
    normalizedKey.includes('password') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('phonenumber') ||
    normalizedKey.includes('currentresidence') ||
    normalizedKey.includes('supabasedburl') ||
    normalizedKey.includes('secret') ||
    (normalizedKey.includes('service') && normalizedKey.includes('key'))
  )
}

function redactString(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, REDACTED)
    .replace(URL_QUERY_SECRET_PATTERN, '$1' + REDACTED)
    .replace(KEY_VALUE_SECRET_PATTERN, (match) => {
      const separator = match.includes(':') ? ':' : '='
      return `${match.split(separator, 1)[0]}${separator}${REDACTED}`
    })
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (isPlainObject(error)) {
    return error
  }

  return { value: String(error) }
}

export function redactSensitiveData<T>(
  value: T,
  seen: WeakSet<object> = new WeakSet()
): T {
  if (typeof value === 'string') {
    return redactString(value) as T
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return CIRCULAR as unknown as T
    }
    seen.add(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, seen)) as unknown as T
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        result[key] = REDACTED
      } else {
        result[key] = redactSensitiveData(val, seen)
      }
    }

    return result as T
  }

  return value
}

function writeLog(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  context?: LogContext
): void {
  const envelope: LogEnvelope = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.userId ? { userId: context.userId } : {}),
    fields: redactSensitiveData(fields)
  }

  const serialized = JSON.stringify(envelope)

  if (level === 'error') {
    console.error(serialized)
    return
  }

  if (level === 'warn') {
    console.warn(serialized)
    return
  }

  console.info(serialized)
}

export function logInfo(
  event: string,
  fields: LogFields = {},
  context?: LogContext
): void {
  writeLog('info', event, fields, context)
}

export function logWarn(
  event: string,
  fields: LogFields = {},
  context?: LogContext
): void {
  writeLog('warn', event, fields, context)
}

export function logError(
  event: string,
  error: unknown,
  fields: LogFields = {},
  context?: LogContext
): void {
  writeLog(
    'error',
    event,
    {
      ...fields,
      error: serializeError(error)
    },
    context
  )
}
