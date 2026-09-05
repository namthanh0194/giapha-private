import { beforeEach, describe, expect, test, vi } from 'vitest'

const { getProfile, getSupabase } = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getSupabase: vi.fn()
}))

vi.mock('@/utils/supabase/queries', () => ({ getProfile, getSupabase }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/utils/errors', () => ({
  toPublicError: vi.fn((_error: unknown, message: string) => ({ id: 'error-id', message }))
}))

import { deleteGalleryItemAction, saveGalleryItemAction } from '@/app/actions/gallery'
import { removeAvatarAction, saveAvatarAction } from '@/app/actions/avatar'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const OBJECT_ID = '44444444-4444-4444-8444-444444444444'

function image(name = 'photo.jpg', type = 'image/jpeg') {
  return new File(['image'], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  getProfile.mockResolvedValue({ id: ADMIN_ID, role: 'admin', is_active: true })
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(OBJECT_ID)
})

describe('gallery storage actions', () => {
  test('removes a newly uploaded object when gallery insert fails', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: null })
    const insert = vi.fn().mockResolvedValue({ error: new Error('insert failed') })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({ insert }))
    })
    const formData = new FormData()
    formData.set('title', 'Family gathering')
    formData.set('file', image())

    const result = await saveGalleryItemAction(formData)

    expect(result).toMatchObject({ success: false, errorId: 'error-id' })
    expect(upload).toHaveBeenCalledWith(
      OBJECT_ID + '.jpg',
      expect.any(File),
      expect.objectContaining({ upsert: false })
    )
    expect(remove).toHaveBeenCalledWith([OBJECT_ID + '.jpg'])
  })

  test('removes the old gallery object only after the database update succeeds', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: null })
    const single = vi.fn().mockResolvedValue({ data: { image_url: 'old.jpg' }, error: null })
    const selectEq = vi.fn(() => ({ single }))
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: selectEq })) })),
      rpc
    })
    const formData = new FormData()
    formData.set('id', ITEM_ID)
    formData.set('expected_version', '1')
    formData.set('title', 'Replacement')
    formData.set('file', image())

    const result = await saveGalleryItemAction(formData)

    expect(result).toEqual({ success: true, version: 2 })
    expect(rpc).toHaveBeenCalledWith('update_versioned_record', {
      target_table: 'gallery_items',
      target_id: ITEM_ID,
      expected_version: 1,
      changes: {
        title: 'Replacement',
        description: null,
        event_date: null,
        image_url: OBJECT_ID + '.jpg'
      }
    })
    expect(remove).toHaveBeenCalledWith(['old.jpg'])
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0])
  })

  test('deletes the database row before removing storage and tolerates cleanup failure', async () => {
    const remove = vi.fn().mockResolvedValue({ error: new Error('storage down') })
    const single = vi.fn().mockResolvedValue({ data: { image_url: 'stored.jpg' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ remove })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) }))
      })),
      rpc
    })

    const result = await deleteGalleryItemAction(ITEM_ID, 1)

    expect(result).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('delete_versioned_record', {
      target_table: 'gallery_items',
      target_id: ITEM_ID,
      expected_version: 1
    })
    expect(remove).toHaveBeenCalledWith(['stored.jpg'])
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0]
    )
  })

  test('does not remove storage when the database delete fails', async () => {
    const remove = vi.fn()
    const single = vi.fn().mockResolvedValue({ data: { image_url: 'stored.jpg' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ error: new Error('delete failed') })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ remove })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) }))
      })),
      rpc
    })

    const result = await deleteGalleryItemAction(ITEM_ID, 1)

    expect(result).toMatchObject({ success: false, errorId: 'error-id' })
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('avatar storage action', () => {
  test('removes a newly uploaded avatar when person update fails', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: null })
    const single = vi.fn().mockResolvedValue({ data: { avatar_url: 'old-avatar.jpg' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ error: new Error('update failed'), data: null })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) }))
      })),
      rpc
    })

    const result = await saveAvatarAction(PERSON_ID, image('avatar.png', 'image/png'), 1)

    expect(result).toMatchObject({ success: false, errorId: 'error-id' })
    expect(upload).toHaveBeenCalledWith(
      PERSON_ID + '/' + OBJECT_ID + '.png',
      expect.any(File),
      expect.objectContaining({ upsert: false })
    )
    expect(remove).toHaveBeenCalledWith([PERSON_ID + '/' + OBJECT_ID + '.png'])
    expect(remove).not.toHaveBeenCalledWith(['old-avatar.jpg'])
  })

  test('rejects unsupported avatar MIME types before upload', async () => {
    const upload = vi.fn()
    getSupabase.mockResolvedValue({ storage: { from: vi.fn(() => ({ upload })) } })

    const result = await saveAvatarAction(PERSON_ID, image('avatar.svg', 'image/svg+xml'), 1)

    expect(result).toEqual({ success: false, error: 'Định dạng ảnh không được hỗ trợ.' })
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('active admin authorization', () => {
  beforeEach(() => {
    getProfile.mockResolvedValue({ id: ADMIN_ID, role: 'editor', is_active: true })
  })

  test.each([
    ['save gallery', () => {
      const formData = new FormData()
      formData.set('title', 'Unauthorized')
      formData.set('file', image())
      return saveGalleryItemAction(formData)
    }],
    ['delete gallery', () => deleteGalleryItemAction(ITEM_ID, 1)]
  ] as const)('rejects editor for %s', async (_name, action) => {
    const result = await action()

    expect(result).toEqual({ success: false, error: 'Từ chối truy cập.' })
    expect(getSupabase).not.toHaveBeenCalled()
  })
})

describe('editor avatar authorization', () => {
  beforeEach(() => {
    getProfile.mockResolvedValue({ id: ADMIN_ID, role: 'editor', is_active: true })
  })

  test('allows an editor to upload an avatar', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: null })
    const single = vi.fn().mockResolvedValue({ data: { avatar_url: null }, error: null })
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc
    })

    await expect(saveAvatarAction(PERSON_ID, image(), 1)).resolves.toEqual({ success: true, version: 2 })
    expect(upload).toHaveBeenCalledOnce()
  })

  test('allows an editor to remove an avatar', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null })
    const single = vi.fn().mockResolvedValue({ data: { avatar_url: 'old-avatar.jpg' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    getSupabase.mockResolvedValue({
      storage: { from: vi.fn(() => ({ remove })) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc
    })

    await expect(removeAvatarAction(PERSON_ID, 1)).resolves.toEqual({ success: true, version: 2 })
    expect(remove).toHaveBeenCalledWith(['old-avatar.jpg'])
  })
})
describe('unauthorized avatar actions', () => {
  test('rejects inactive or viewer users', async () => {
    getProfile.mockResolvedValueOnce({ id: ADMIN_ID, role: 'editor', is_active: false })
    await expect(saveAvatarAction(PERSON_ID, image(), 1)).resolves.toEqual({ success: false, error: 'Từ chối truy cập.' })

    getProfile.mockResolvedValueOnce({ id: ADMIN_ID, role: 'viewer', is_active: true })
    await expect(removeAvatarAction(PERSON_ID, 1)).resolves.toEqual({ success: false, error: 'Từ chối truy cập.' })
  })
})