'use server'

import { getAvatarStoragePath } from '@/utils/avatar'
import { toPublicError } from '@/utils/errors'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { revalidatePath } from 'next/cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_MIME_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/gif', 'gif'], ['image/webp', 'webp']
])
const MAX_AVATAR_SIZE = 2 * 1024 * 1024

export interface StorageActionResult {
  success: boolean
  version?: number
  conflict?: boolean
  error?: string
  errorId?: string
  retryable?: boolean
}

function extensionFor(file: File) {
  const mimeExtension = ALLOWED_MIME_TYPES.get(file.type)
  if (!mimeExtension) return null
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)
    ? extension === 'jpeg' ? 'jpg' : extension
    : mimeExtension
}

export async function saveAvatarAction(personId: string, file: File, expectedVersion: number): Promise<StorageActionResult> {
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin') {
    return { success: false, error: 'Từ chối truy cập.' }
  }
  if (!UUID_PATTERN.test(personId)) return { success: false, error: 'Mã thành viên không hợp lệ.' }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return { success: false, error: 'Phiên bản hồ sơ không hợp lệ.' }
  if (file.size > MAX_AVATAR_SIZE) return { success: false, error: 'Dung lượng ảnh đại diện phải nhỏ hơn 2MB.' }

  const extension = extensionFor(file)
  if (!extension) return { success: false, error: 'Định dạng ảnh không được hỗ trợ.' }

  const supabase = await getSupabase()
  const { data: person, error: fetchError } = await supabase.from('persons').select('avatar_url').eq('id', personId).single()
  if (fetchError || !person) {
    const publicError = toPublicError(fetchError || new Error('Not found'), 'Không tìm thấy thành viên.', { event: 'avatar.save.fetch_person_failed', fields: { personId } })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  const oldStoragePath = getAvatarStoragePath(person.avatar_url)
  const objectPath = personId + '/' + crypto.randomUUID() + '.' + extension
  const { error: uploadError } = await supabase.storage.from('avatars').upload(objectPath, file, { cacheControl: '3600', upsert: false })
  if (uploadError) {
    const publicError = toPublicError(uploadError, 'Không thể tải ảnh đại diện lên.', { event: 'avatar.save.upload_failed', fields: { personId } })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  const { data: version, error: updateError } = await supabase.rpc('update_versioned_record', {
    target_table: 'persons',
    target_id: personId,
    expected_version: expectedVersion,
    changes: { avatar_url: objectPath }
  })
  if (updateError?.code === '40001') {
    await supabase.storage.from('avatars').remove([objectPath])
    return { success: false, conflict: true, error: 'Dữ liệu đã được người khác cập nhật.' }
  }
  if (updateError || !Number.isSafeInteger(version)) {
    await supabase.storage.from('avatars').remove([objectPath])
    const publicError = toPublicError(updateError, 'Không thể cập nhật ảnh đại diện.', { event: 'avatar.save.update_failed', fields: { personId } })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  if (oldStoragePath && oldStoragePath !== objectPath) await supabase.storage.from('avatars').remove([oldStoragePath])
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/members/' + personId)
  return { success: true, version }
}

export async function removeAvatarAction(personId: string, expectedVersion: number): Promise<StorageActionResult> {
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin') {
    return { success: false, error: 'Từ chối truy cập.' }
  }
  if (!UUID_PATTERN.test(personId)) return { success: false, error: 'Mã thành viên không hợp lệ.' }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return { success: false, error: 'Phiên bản hồ sơ không hợp lệ.' }

  const supabase = await getSupabase()
  const { data: person, error: fetchError } = await supabase.from('persons').select('avatar_url').eq('id', personId).single()
  if (fetchError || !person) {
    const publicError = toPublicError(fetchError || new Error('Not found'), 'Không tìm thấy thành viên.', { event: 'avatar.remove.fetch_person_failed', fields: { personId } })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  const oldStoragePath = getAvatarStoragePath(person.avatar_url)
  const { data: version, error: updateError } = await supabase.rpc('update_versioned_record', {
    target_table: 'persons',
    target_id: personId,
    expected_version: expectedVersion,
    changes: { avatar_url: null }
  })
  if (updateError?.code === '40001') {
    return { success: false, conflict: true, error: 'Dữ liệu đã được người khác cập nhật.' }
  }
  if (updateError || !Number.isSafeInteger(version)) {
    const publicError = toPublicError(updateError, 'Không thể gỡ ảnh đại diện.', { event: 'avatar.remove.update_failed', fields: { personId } })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  if (oldStoragePath) await supabase.storage.from('avatars').remove([oldStoragePath])
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/members/' + personId)
  return { success: true, version }
}
