import { createClient } from '@/utils/supabase/server'
import { notifyAdminOfPendingUser } from '@/utils/approval-notification'
import { withTelemetry } from '@/utils/telemetry'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  return await withTelemetry('auth.callback', { route: '/auth/callback', roleClass: 'anonymous' }, async () => {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const authError = requestUrl.searchParams.get('error')

  if (authError) {
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', requestUrl.origin)
    )
  }

  if (code) {
    const supabase = createClient(await cookies())
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      return NextResponse.redirect(
        new URL('/login?error=auth_callback_failed', requestUrl.origin)
      )
    }

    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (user?.email) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .maybeSingle()

      if (profile?.role === 'member' && !profile.is_active) {
        await notifyAdminOfPendingUser({
          id: user.id,
          email: user.email
        })
      }
    }
  }

  return NextResponse.redirect(new URL('/dashboard', requestUrl.origin))
  })
}
