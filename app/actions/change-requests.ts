'use server'

import { revalidatePath } from 'next/cache'
import { toPublicError } from '@/utils/errors'
import { logInfo, logWarn } from '@/utils/logger'
import { withTelemetry } from '@/utils/telemetry'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export type ChangeRequestTarget =
  'persons' | 'custom_events' | 'sources' | 'person_citations'

export type NotificationStatus = {
  sent: boolean
  configured: boolean
  reason?: string
}

export type ChangeRequestActionResult = {
  success: boolean
  error?: string
  errorId?: string
  notification?: NotificationStatus
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TARGETS = new Set<ChangeRequestTarget>([
  'persons',
  'custom_events',
  'sources',
  'person_citations'
])

const STALE_CHANGE_REQUEST_MESSAGE =
  'Dữ liệu gốc đã thay đổi sau khi đề xuất được gửi. Hãy tải lại và tạo đề xuất mới.'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        character
      ] ?? character
  )
}

async function notifyRequester(
  requesterId: string,
  requestId: string,
  outcome: 'approved' | 'rejected',
  note: string
): Promise<NotificationStatus> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    const status = {
      sent: false,
      configured: false,
      reason: 'missing_configuration'
    }
    logWarn('change_request.notification.skipped', {
      requestId,
      outcome,
      ...status
    })
    return status
  }

  let adminSupabase
  try {
    adminSupabase = getAdminSupabase()
  } catch (error) {
    const status = {
      sent: false,
      configured: false,
      reason: 'missing_service_key'
    }
    logWarn('change_request.notification.skipped', {
      requestId,
      outcome,
      ...status,
      error: String(error)
    })
    return status
  }

  const { data, error: userError } =
    await adminSupabase.auth.admin.getUserById(requesterId)
  const email = data.user?.email
  if (userError || !email) {
    const status = {
      sent: false,
      configured: true,
      reason: 'requester_email_unavailable'
    }
    logWarn('change_request.notification.failed', {
      requestId,
      outcome,
      ...status
    })
    return status
  }

  const outcomeLabel = outcome === 'approved' ? 'được duyệt' : 'bị từ chối'
  const safeNote = escapeHtml(note || 'Không có ghi chú.')
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Đề xuất đóng góp đã ${outcomeLabel}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#292524"><h2>Đề xuất đóng góp đã ${outcomeLabel}</h2><p>Mã đề xuất: <strong>${escapeHtml(requestId)}</strong></p><p>Ghi chú rà soát: ${safeNote}</p></div>`,
        text: `Đề xuất ${requestId} đã ${outcomeLabel}. Ghi chú: ${note || 'Không có ghi chú.'}`
      })
    })

    if (!response.ok) {
      const status = {
        sent: false,
        configured: true,
        reason: 'email_send_failed'
      }
      logWarn('change_request.notification.failed', {
        requestId,
        outcome,
        httpStatus: response.status,
        ...status
      })
      return status
    }
  } catch (error) {
    const status = {
      sent: false,
      configured: true,
      reason: 'email_send_failed'
    }
    logWarn('change_request.notification.failed', {
      requestId,
      outcome,
      ...status,
      error: String(error)
    })
    return status
  }

  const status = { sent: true, configured: true }
  logInfo('change_request.notification.sent', { requestId, outcome, ...status })
  return status
}

export async function submitChangeRequest(input: {
  targetTable: ChangeRequestTarget
  targetId: string
  operation: 'INSERT' | 'UPDATE'
  proposedData: Record<string, unknown>
}): Promise<ChangeRequestActionResult> {
  if (
    !TARGETS.has(input.targetTable) ||
    !UUID_PATTERN.test(input.targetId) ||
    !isPlainObject(input.proposedData) ||
    Object.keys(input.proposedData).length === 0 ||
    JSON.stringify(input.proposedData).length > 50_000
  ) {
    return { success: false, error: 'Dữ liệu đề xuất không hợp lệ.' }
  }

  const profile = await getProfile()
  if (!profile?.is_active) return { success: false, error: 'Từ chối truy cập.' }

  const supabase = await getSupabase()
  const { error } = await supabase.rpc('submit_change_request', {
    target_table: input.targetTable,
    target_id: input.targetId,
    operation: input.operation,
    proposed_data: input.proposedData
  })

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể gửi đề xuất đóng góp.',
      {
        event: 'change_request.submit.failed',
        fields: { targetTable: input.targetTable, targetId: input.targetId }
      }
    )
    return {
      success: false,
      error: publicError.message,
      errorId: publicError.id
    }
  }

  revalidatePath('/dashboard/reviews')
  return { success: true }
}

async function reviewChangeRequest(
  requestId: string,
  outcome: 'approved' | 'rejected',
  note: string
): Promise<ChangeRequestActionResult> {
  return await withTelemetry(`change_request.${outcome}`, { route: '/actions/change-requests', roleClass: 'unknown' }, async () => {
  if (!UUID_PATTERN.test(requestId) || note.length > 5000) {
    return { success: false, error: 'Dữ liệu rà soát không hợp lệ.' }
  }
  if (outcome === 'rejected' && note.trim().length === 0) {
    return { success: false, error: 'Cần nhập ghi chú khi từ chối.' }
  }

  const profile = await getProfile()
  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return { success: false, error: 'Từ chối truy cập.' }
  }

  const supabase = await getSupabase()
  const { data: request, error: requestError } = await supabase
    .from('change_requests')
    .select('id, requester_id')
    .eq('id', requestId)
    .maybeSingle()
  if (requestError || !request) {
    return { success: false, error: 'Không tìm thấy đề xuất cần rà soát.' }
  }

  const { error } = await supabase.rpc(
    outcome === 'approved' ? 'approve_change_request' : 'reject_change_request',
    { request_id: requestId, note: note.trim() || null }
  )
  if (error) {
    const publicError = toPublicError(error, 'Không thể cập nhật đề xuất.', {
      event: `change_request.${outcome}.failed`,
      fields: { requestId }
    })
    return {
      success: false,
      error: error.message.includes('Conflict: Target data was modified')
        ? STALE_CHANGE_REQUEST_MESSAGE
        : publicError.message,
      errorId: publicError.id
    }
  }

  revalidatePath('/dashboard/reviews')
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/events')
  const notification = await notifyRequester(
    request.requester_id,
    requestId,
    outcome,
    note.trim()
  )
  return { success: true, notification }
  })
}

export async function approveChangeRequest(requestId: string, note = '') {
  return await reviewChangeRequest(requestId, 'approved', note)
}

export async function rejectChangeRequest(requestId: string, note: string) {
  return await reviewChangeRequest(requestId, 'rejected', note)
}

export async function withdrawChangeRequest(
  requestId: string
): Promise<ChangeRequestActionResult> {
  if (!UUID_PATTERN.test(requestId)) {
    return { success: false, error: 'Mã đề xuất không hợp lệ.' }
  }

  const supabase = await getSupabase()
  const { error } = await supabase.rpc('withdraw_change_request', {
    request_id: requestId
  })
  if (error) {
    const publicError = toPublicError(error, 'Không thể rút đề xuất.', {
      event: 'change_request.withdraw.failed',
      fields: { requestId }
    })
    return {
      success: false,
      error: publicError.message,
      errorId: publicError.id
    }
  }

  revalidatePath('/dashboard/reviews')
  return { success: true }
}
