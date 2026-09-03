'use server'

import { revalidatePath } from 'next/cache'
import { toPublicError } from '@/utils/errors'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

type UndoAuditResult = {
  success: boolean
  table_name?: 'persons' | 'relationships' | 'custom_events' | 'gallery_items'
}

export type UndoAuditActionResult =
  | { success: true; error?: never; errorId?: never }
  | { success: false; error: string; errorId?: string }

export async function undoAuditEntryAction(
  auditId: number
): Promise<UndoAuditActionResult> {
  if (!Number.isSafeInteger(auditId) || auditId <= 0) {
    return { success: false, error: 'Mã lịch sử không hợp lệ.' }
  }

  const profile = await getProfile()
  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return { success: false, error: 'Từ chối truy cập.' }
  }

  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('undo_audit_entry', {
    audit_id: auditId
  })

  if (error || !(data as UndoAuditResult | null)?.success) {
    const publicError = toPublicError(
      error ?? new Error('Undo RPC returned an unsuccessful result.'),
      'Không thể hoàn tác thay đổi này.',
      { event: 'audit.undo.failed', fields: { auditId } }
    )
    return {
      success: false,
      error: publicError.message,
      errorId: publicError.id
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/activity')

  switch ((data as UndoAuditResult).table_name) {
    case 'persons':
    case 'relationships':
      revalidatePath('/dashboard/members')
      revalidatePath('/dashboard/kinship')
      break
    case 'custom_events':
      revalidatePath('/dashboard/events')
      break
    case 'gallery_items':
      revalidatePath('/dashboard/gallery')
      break
  }

  return { success: true }
}
