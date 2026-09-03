import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { withTelemetry } from '@/utils/telemetry'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  return await withTelemetry('search.persons', { route: '/api/search/persons' }, async (scope) => {
  const params = new URL(request.url).searchParams
  const query = params.get('q')?.trim() ?? ''
  const limitValue = params.get('limit') ?? '20'

  if (Array.from(query).length < 2 || Array.from(query).length > 100) {
    return NextResponse.json(
      { error: 'Invalid search query' },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }

  if (!/^\d+$/.test(limitValue)) {
    return NextResponse.json(
      { error: 'Invalid result limit' },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }

  const resultLimit = Number(limitValue)
  if (resultLimit < 1 || resultLimit > 20) {
    return NextResponse.json(
      { error: 'Invalid result limit' },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }

  const supabase = createClient(await cookies())
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE_HEADERS }
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_active) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: NO_STORE_HEADERS }
    )
  }

  const { data, error } = await supabase.rpc('search_persons', {
    query,
    result_limit: resultLimit
  })

  if (error) {
    return NextResponse.json(
      { error: 'Search unavailable' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }

  const persons = (data ?? []).slice(0, 20)
  scope.add({ rowCount: persons.length, payloadBytes: query.length })
  return NextResponse.json(
    { persons },
    { headers: NO_STORE_HEADERS }
  )
  })
}
