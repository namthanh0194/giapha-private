import { hashApprovalToken } from '@/utils/approval'
import { logError, logInfo, logWarn } from '@/utils/logger'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { withTelemetry } from '@/utils/telemetry'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ token: string }>
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character] || character
  )
}

function htmlResponse(content: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
      <html lang="vi">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Gia phả Nguyễn Đăng Tộc - Duyệt tài khoản</title>
        </head>
        <body style="margin:0;background:#fafaf9;font-family:Arial,sans-serif;color:#292524">
          <main style="box-sizing:border-box;max-width:560px;margin:0 auto;padding:48px 20px">
            <section style="background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:32px;box-shadow:0 4px 16px rgba(28,25,23,.06)">
              ${content}
            </section>
          </main>
        </body>
      </html>`,
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  )
}

async function getRequest(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return { supabase: null, request: null }

  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('user_approval_requests')
    .select('id, user_id, email, expires_at, used_at')
    .eq('token_hash', hashApprovalToken(token))
    .maybeSingle()

  if (error) throw error
  return { supabase, request: data }
}

function invalidRequestResponse() {
  return htmlResponse(
    '<h1 style="margin-top:0;color:#991b1b">Liên kết không hợp lệ</h1><p>Liên kết duyệt tài khoản không tồn tại hoặc đã hết hạn.</p>',
    404
  )
}

export async function GET(_request: Request, { params }: RouteContext) {
  return await withTelemetry('admin.approval_view', { route: '/api/admin/approve/[token]', roleClass: 'anonymous' }, async () => {
  try {
    const { token } = await params
    const { request } = await getRequest(token)

    if (!request) return invalidRequestResponse()

    if (request.used_at) {
      return htmlResponse(
        '<h1 style="margin-top:0;color:#166534">Đã xử lý</h1><p>Yêu cầu duyệt tài khoản này đã được sử dụng.</p>'
      )
    }

    if (new Date(request.expires_at).getTime() <= Date.now()) {
      return invalidRequestResponse()
    }

    return htmlResponse(`
      <h1 style="margin-top:0;color:#b45309">Duyệt tài khoản</h1>
      <p>Tài khoản sau đang chờ được cấp quyền truy cập dữ liệu gia phả:</p>
      <p style="font-weight:700">${escapeHtml(request.email)}</p>
      <form method="post">
        <button type="submit" style="border:0;border-radius:8px;background:#d97706;color:#fff;cursor:pointer;font-size:16px;padding:11px 18px">
          Xác nhận duyệt
        </button>
      </form>
      <p style="color:#78716c;font-size:13px;margin-bottom:0">Nếu không nhận ra tài khoản này, bạn có thể đóng trang.</p>
    `)
  } catch (error) {
    logError('admin.approval.open_failed', error)
    return htmlResponse(
      '<h1 style="margin-top:0;color:#991b1b">Không thể xử lý</h1><p>Hệ thống chưa được cấu hình để duyệt tài khoản qua email. Vui lòng đăng nhập ứng dụng để duyệt.</p>',
      503
    )
  }
  })
}

export async function POST(_request: Request, { params }: RouteContext) {
  return await withTelemetry('admin.approval_submit', { route: '/api/admin/approve/[token]', roleClass: 'anonymous' }, async () => {
  try {
    const requestOrigin = new URL(_request.url).origin
    const requestOriginHeader = _request.headers.get('origin')
    const requestReferer = _request.headers.get('referer')
    if (
      (requestOriginHeader && requestOriginHeader !== requestOrigin) ||
      (requestReferer && !requestReferer.startsWith(`${requestOrigin}/`))
    ) {
      logWarn('admin.approval.invalid_origin', {
        hasOriginHeader: Boolean(requestOriginHeader),
        hasReferer: Boolean(requestReferer)
      })
      return htmlResponse(
        '<h1 style="margin-top:0;color:#991b1b">Yêu cầu không hợp lệ</h1>',
        403
      )
    }

    const { token } = await params
    const { supabase, request } = await getRequest(token)

    if (!request || !supabase) return invalidRequestResponse()

    if (request.used_at) {
      return htmlResponse(
        '<h1 style="margin-top:0;color:#166534">Đã xử lý</h1><p>Yêu cầu duyệt tài khoản này đã được sử dụng.</p>'
      )
    }

    if (new Date(request.expires_at).getTime() <= Date.now()) {
      return invalidRequestResponse()
    }

    // Claim the one-time request first. The conditional update makes two
    // concurrent clicks mutually exclusive even though this route is stateless.
    const { data: claimedRequest, error: claimError } = await supabase
      .from('user_approval_requests')
      .update({ used_at: new Date().toISOString() })
      .eq('id', request.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle()

    if (claimError) throw claimError
    if (!claimedRequest) {
      logWarn('admin.approval.already_claimed', {
        approvalRequestId: request.id
      }, { requestId: request.id, userId: request.user_id })
      return htmlResponse(
        '<h1 style="margin-top:0;color:#166534">Đã xử lý</h1><p>Yêu cầu duyệt tài khoản này đã được sử dụng.</p>'
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', request.user_id)
      .maybeSingle()

    if (profileError) {
      logError(
        'admin.approval.profile_lookup_failed',
        profileError,
        { approvalRequestId: request.id },
        { requestId: request.id, userId: request.user_id }
      )
      return htmlResponse(
        '<h1 style="margin-top:0;color:#991b1b">Không tìm thấy tài khoản</h1><p>Tài khoản có thể đã bị xóa.</p>',
        404
      )
    }

    if (!profile) {
      logWarn('admin.approval.profile_not_found', {
        approvalRequestId: request.id
      }, { requestId: request.id, userId: request.user_id })
      return htmlResponse(
        '<h1 style="margin-top:0;color:#991b1b">Không tìm thấy tài khoản</h1><p>Tài khoản có thể đã bị xóa.</p>',
        404
      )
    }

    if (!profile.is_active) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', request.user_id)
        .eq('is_active', false)

      if (updateError) throw updateError
    }

    logInfo('admin.approval.completed', {
      approvalRequestId: request.id
    }, { requestId: request.id, userId: request.user_id })
    return htmlResponse(
      `<h1 style="margin-top:0;color:#166534">Duyệt thành công</h1><p>Tài khoản <strong>${escapeHtml(request.email)}</strong> đã được cấp quyền truy cập. Người dùng có thể đăng nhập ứng dụng ngay bây giờ.</p>`
    )
  } catch (error) {
    logError('admin.approval.failed', error)
    return htmlResponse(
      '<h1 style="margin-top:0;color:#991b1b">Duyệt thất bại</h1><p>Đã xảy ra lỗi khi cập nhật trạng thái. Vui lòng thử lại hoặc duyệt trong ứng dụng.</p>',
      500
    )
  }
  })
}
