import { logError } from '@/utils/logger'
import { withTelemetry } from '@/utils/telemetry'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  return await withTelemetry('health.readiness', { route: '/api/readiness' }, async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { status: 'not_ready', reason: 'configuration_missing' },
      { status: 503, headers: NO_STORE_HEADERS }
    )
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
    const { data, error } = await supabase
      .rpc('check_readiness')
      .abortSignal(AbortSignal.timeout(5000))

    if (error || data !== true) {
      throw error ?? new Error('Readiness check returned an unexpected result.')
    }

    return NextResponse.json(
      { status: 'ready', database: 'connected' },
      { headers: NO_STORE_HEADERS }
    )
  } catch (error) {
    logError('readiness.database_check_failed', error)

    return NextResponse.json(
      { status: 'not_ready', reason: 'database_unavailable' },
      { status: 503, headers: NO_STORE_HEADERS }
    )
  }
  })
}
