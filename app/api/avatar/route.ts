import { getAvatarStoragePath } from '@/utils/avatar'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const requestedPath = new URL(request.url).searchParams.get('path')
  const path = getAvatarStoragePath(requestedPath)

  if (!path || path.length > 512 || path.includes('..')) {
    return new NextResponse('Invalid avatar path', { status: 400 })
  }

  const supabase = createClient(await cookies())
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_active) return new NextResponse('Forbidden', { status: 403 })

  // Validate visibility of target person: extract person id if possible or match avatar_url
  const firstSegment = path.split('/')[0]
  const isSegmentUuid = UUID_PATTERN.test(firstSegment)

  let personQuery = supabase.from('persons').select('id, avatar_url').limit(1)

  if (isSegmentUuid) {
    personQuery = personQuery.eq('id', firstSegment)
  } else {
    personQuery = personQuery.eq('avatar_url', path)
  }

  const { data: visiblePerson } = await personQuery.maybeSingle()
  if (
    !visiblePerson ||
    getAvatarStoragePath(visiblePerson.avatar_url) !== path
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  const { data, error } = await supabase.storage.from('avatars').download(path)

  if (error || !data) return new NextResponse('Not found', { status: 404 })

  if (!data.type.startsWith('image/')) {
    return new NextResponse('Unsupported avatar type', { status: 415 })
  }

  return new NextResponse(data, {
    headers: {
      'Cache-Control': 'private, max-age=300',
      'Content-Type': data.type,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}
