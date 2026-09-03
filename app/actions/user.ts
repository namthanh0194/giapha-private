'use server'

import { UserRole } from '@/types'
import { toPublicError } from '@/utils/errors'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { revalidatePath } from 'next/cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function hasActiveAdminAccess() {
  const profile = await getProfile()
  return Boolean(profile?.is_active && profile.role === 'admin')
}

function invalidUserId() {
  return { error: 'Mã người dùng không hợp lệ.' }
}

export async function changeUserRole(userId: string, newRole: UserRole) {
  if (!(await hasActiveAdminAccess())) return { error: 'Từ chối truy cập.' }
  if (!UUID_PATTERN.test(userId)) return invalidUserId()

  const supabase = await getSupabase()
  const { error } = await supabase.rpc('set_user_role', {
    target_user_id: userId,
    new_role: newRole
  })

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể thay đổi vai trò người dùng.',
      { event: 'user.role.change_failed', fields: { targetUserId: userId, newRole } }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}

export async function deleteUser(userId: string) {
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin') {
    return { error: 'Từ chối truy cập.' }
  }
  if (!UUID_PATTERN.test(userId)) return invalidUserId()
  if (userId === profile.id) return { error: 'Không thể tự xoá tài khoản của bạn.' }

  const supabase = getAdminSupabase()
  const { data: reservations, error: reservationError } = await supabase.rpc(
    'reserve_admin_user_deletion',
    { target_user_id: userId }
  )

  if (reservationError) {
    if (reservationError.message.includes('last active administrator')) {
      return { error: 'Không thể xoá quản trị viên đang hoạt động cuối cùng.' }
    }
    const publicError = toPublicError(reservationError, 'Không thể kiểm tra người dùng.', {
      event: 'user.delete.reservation_failed',
      fields: { targetUserId: userId }
    })
    return { error: publicError.message, errorId: publicError.id }
  }

  const reservation = reservations?.[0]
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) {
    if (reservation?.role === 'admin' && reservation.previous_is_active) {
      const { error: restoreError } = await supabase.rpc(
        'restore_admin_user_deletion_reservation',
        {
          target_user_id: userId,
          restore_is_active: reservation.previous_is_active
        }
      )

      if (restoreError) {
        const publicError = toPublicError(
          restoreError,
          'Không thể khôi phục trạng thái quản trị viên. Vui lòng thử lại.',
          {
            event: 'user.delete.restore_failed',
            fields: { targetUserId: userId }
          }
        )
        return { error: publicError.message, errorId: publicError.id, retryable: true }
      }
    }

    const publicError = toPublicError(error, 'Không thể xoá người dùng lúc này. Vui lòng thử lại.', {
      event: 'user.delete.auth_failed',
      fields: { targetUserId: userId }
    })
    return { error: publicError.message, errorId: publicError.id, retryable: true }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}

export async function adminCreateUser(formData: FormData) {
  if (!(await hasActiveAdminAccess())) return { error: 'Từ chối truy cập.' }

  const email = formData.get('email')?.toString().trim()
  const password = formData.get('password')?.toString()
  const role = formData.get('role')?.toString() || 'member'
  const isActive = formData.get('is_active')?.toString() !== 'false'

  if (role !== 'admin' && role !== 'editor' && role !== 'member') {
    return { error: 'Vai trò không hợp lệ.' }
  }
  if (!email || !password) return { error: 'Email và mật khẩu là bắt buộc.' }
  if (password.length < 8) return { error: 'Mật khẩu phải có ít nhất 8 ký tự.' }

  const supabase = getAdminSupabase()
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })

  if (error || !data.user) {
    const publicError = toPublicError(error || new Error('Auth user was not created'), 'Không thể tạo người dùng.', {
      event: 'user.create.auth_failed',
      fields: { role }
    })
    return { error: publicError.message, errorId: publicError.id }
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: data.user.id, role, is_active: isActive })

  if (profileError) {
    const { error: cleanupError } = await supabase.auth.admin.deleteUser(data.user.id)
    if (cleanupError) {
      const publicError = toPublicError(
        cleanupError,
        'Không thể hoàn tất việc dọn dẹp tài khoản sau khi tạo thất bại.',
        {
          event: 'user.create.cleanup_failed',
          fields: { role, userId: data.user.id }
        }
      )
      return { error: publicError.message, errorId: publicError.id }
    }
    const publicError = toPublicError(profileError, 'Không thể tạo hồ sơ người dùng.', {
      event: 'user.create.profile_upsert_failed',
      fields: { role, userId: data.user.id }
    })
    return { error: publicError.message, errorId: publicError.id }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}

export async function toggleUserStatus(userId: string, newStatus: boolean) {
  if (!(await hasActiveAdminAccess())) return { error: 'Từ chối truy cập.' }
  if (!UUID_PATTERN.test(userId)) return invalidUserId()

  const supabase = await getSupabase()
  const { error } = await supabase.rpc('set_user_active_status', {
    target_user_id: userId,
    new_status: newStatus
  })

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể thay đổi trạng thái người dùng.',
      { event: 'user.status.change_failed', fields: { targetUserId: userId, newStatus } }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}
