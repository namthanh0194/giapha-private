import { logError, type LogContext, type LogFields } from '@/utils/logger'

export type PublicError = {
  id: string
  message: string
}

export function createErrorId(): string {
  return crypto.randomUUID()
}

interface PublicErrorLogOptions {
  event?: string
  fields?: LogFields
  context?: LogContext
}

export function toPublicError(
  error: unknown,
  fallback: string,
  options: PublicErrorLogOptions = {}
): PublicError {
  const id = createErrorId()
  logError(
    options.event ?? 'server.operation.failed',
    error,
    { errorId: id, ...options.fields },
    options.context
  )
  return { id, message: fallback }
}
