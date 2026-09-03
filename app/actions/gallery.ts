'use server'

import { toPublicError } from '@/utils/errors'
import { logWarn } from '@/utils/logger'
import { withTelemetry } from '@/utils/telemetry'
import { getGalleryStoragePath } from '@/utils/supabase/storage-path'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { revalidatePath } from 'next/cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_MIME_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/gif', 'gif'], ['image/webp', 'webp']
])
const MAX_FILE_SIZE = 10 * 1024 * 1024

export interface StorageActionResult {
  success: boolean
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

export interface VersionedStorageActionResult extends StorageActionResult {
  version?: number
  conflict?: boolean
}

export async function saveGalleryItemAction(formData: FormData): Promise<VersionedStorageActionResult> {
  return await withTelemetry('gallery.save_item', { route: '/actions/gallery', roleClass: 'admin' }, async () => {
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin') {
    return { success: false, error: 'Từ chối truy cập.' }
  }

  const id = formData.get('id')?.toString().trim() || null
  const title = formData.get('title')?.toString().trim() || ''
  const description = formData.get('description')?.toString().trim() || null
  const eventDate = formData.get('event_date')?.toString().trim() || null
  const rawFile = formData.get('file')
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null

  if (id && !UUID_PATTERN.test(id)) return { success: false, error: 'Mã hình ảnh không hợp lệ.' }
  if (!title || title.length > 200) return { success: false, error: 'Tiêu đề phải từ 1 đến 200 ký tự.' }
  if (description && description.length > 2000) return { success: false, error: 'Mô tả không được vượt quá 2000 ký tự.' }
  if (!id && !file) return { success: false, error: 'Vui lòng chọn hình ảnh.' }

  const extension = file ? extensionFor(file) : null
  if (file && file.size > MAX_FILE_SIZE) return { success: false, error: 'Dung lượng ảnh phải nhỏ hơn 10MB.' }
  if (file && !extension) return { success: false, error: 'Định dạng ảnh không được hỗ trợ.' }

  const supabase = await getSupabase()
  let oldStoragePath: string | null = null
  if (id) {
    const { data, error } = await supabase.from('gallery_items').select('image_url').eq('id', id).single()
    if (error || !data) {
      const publicError = toPublicError(error || new Error('Not found'), 'Không tìm thấy hình ảnh.', { event: 'gallery.save.fetch_existing_failed', fields: { id } })
      return { success: false, error: publicError.message, errorId: publicError.id }
    }
    oldStoragePath = getGalleryStoragePath(data.image_url)
  }

  let uploadedPath: string | null = null
  if (file && extension) {
    uploadedPath = crypto.randomUUID() + '.' + extension
    const { error } = await supabase.storage.from('gallery').upload(uploadedPath, file, { cacheControl: '3600', upsert: false })
    if (error) {
      const publicError = toPublicError(error, 'Lỗi khi tải ảnh lên.', { event: 'gallery.save.upload_failed', fields: { id, fileName: file.name } })
      return { success: false, error: publicError.message, errorId: publicError.id }
    }
  }

  const payload: { title: string; description: string | null; event_date: string | null; image_url?: string; created_by?: string } = { title, description, event_date: eventDate }
  if (uploadedPath) payload.image_url = uploadedPath

  if (id) {
    const rawExpectedVersion = formData.get('expected_version')
    const expectedVersion = rawExpectedVersion ? Number(rawExpectedVersion) : null

    if (expectedVersion === null || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      if (uploadedPath) await supabase.storage.from('gallery').remove([uploadedPath])
      return { success: false, error: 'Phiên bản hình ảnh không hợp lệ.' }
    }

    const { data, error } = await supabase.rpc('update_versioned_record', {
      target_table: 'gallery_items',
      target_id: id,
      expected_version: expectedVersion,
      changes: payload
    })
    if (error?.code === '40001') {
      if (uploadedPath) await supabase.storage.from('gallery').remove([uploadedPath])
      return {
        success: false,
        conflict: true,
        error: 'Dữ liệu đã được người khác cập nhật.'
      }
    }
    if (error || !Number.isSafeInteger(data)) {
      if (uploadedPath) await supabase.storage.from('gallery').remove([uploadedPath])
      const publicError = toPublicError(error ?? new Error('No version returned'), 'Không thể cập nhật thông tin ảnh.', { event: 'gallery.save.update_failed', fields: { id } })
      return { success: false, error: publicError.message, errorId: publicError.id }
    }
    const nextVersion = data
    if (uploadedPath && oldStoragePath && oldStoragePath !== uploadedPath) await supabase.storage.from('gallery').remove([oldStoragePath])
    revalidatePath('/dashboard/gallery')
    return { success: true, version: nextVersion }
  } else {
    payload.created_by = profile.id
    const { error } = await supabase.from('gallery_items').insert(payload)
    if (error) {
      if (uploadedPath) await supabase.storage.from('gallery').remove([uploadedPath])
      const publicError = toPublicError(error, 'Không thể lưu hình ảnh vào cơ sở dữ liệu.', { event: 'gallery.save.insert_failed', fields: { title } })
      return { success: false, error: publicError.message, errorId: publicError.id }
    }
  }

  revalidatePath('/dashboard/gallery')
  return { success: true }
  })
}

export async function deleteGalleryItemAction(itemId: string, expectedVersion: number): Promise<StorageActionResult> {
  return await withTelemetry('gallery.delete_item', { route: '/actions/gallery', roleClass: 'admin' }, async () => {
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin') {
    return { success: false, error: 'Từ chối truy cập.' }
  }
  if (!UUID_PATTERN.test(itemId)) return { success: false, error: 'Mã hình ảnh không hợp lệ.' }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return { success: false, error: 'Phiên bản hình ảnh không hợp lệ.' }
  }

  const supabase = await getSupabase()
  const { data: item, error: fetchError } = await supabase.from('gallery_items').select('image_url').eq('id', itemId).single()
  if (fetchError || !item) {
    const publicError = toPublicError(fetchError || new Error('Not found'), 'Không tìm thấy hình ảnh.', { event: 'gallery.delete.fetch_failed', fields: { itemId } })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  const storagePath = getGalleryStoragePath(item.image_url)

  const { error: deleteError } = await supabase.rpc('delete_versioned_record', {
    target_table: 'gallery_items',
    target_id: itemId,
    expected_version: expectedVersion
  })

  if (deleteError?.code === '40001') {
    return { success: false, conflict: true, error: 'Dữ liệu đã được người khác cập nhật.' }
  }

  if (deleteError) {
    const publicError = toPublicError(deleteError, 'Không thể xóa dữ liệu hình ảnh.', {
      event: 'gallery.delete.db_failed',
      fields: { itemId }
    })
    return {
      success: false,
      retryable: true,
      error: publicError.message,
      errorId: publicError.id
    }
  }

  if (storagePath) {
    const { error: removeError } = await supabase.storage
      .from('gallery')
      .remove([storagePath])

    if (removeError) {
      void withTelemetry('storage.compensation_failed', {
        route: '/actions/gallery',
        roleClass: 'admin',
        status: 500
      }, async () => undefined)
      logWarn('gallery.delete.storage_cleanup_failed', {
        itemId,
        storagePath,
        error: removeError instanceof Error ? removeError.message : String(removeError)
      })
    }
  }

  revalidatePath('/dashboard/gallery')
  return { success: true }
  })
}
