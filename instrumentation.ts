export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { registerTelemetry } = await import('@/utils/telemetry')
  registerTelemetry()
}
