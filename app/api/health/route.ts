import packageJson from '@/package.json'
import { withTelemetry } from '@/utils/telemetry'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return withTelemetry('health.liveness', { route: '/api/health', status: 200 }, async () => NextResponse.json(
    {
      status: 'ok',
      version: packageJson.version
    },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  ))
}
