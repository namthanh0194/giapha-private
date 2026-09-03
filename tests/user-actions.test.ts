import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  getAdminSupabase,
  getProfile,
  getSupabase,
  revalidatePath,
  toPublicError
} = vi.hoisted(() => ({
  getAdminSupabase: vi.fn(),
  getProfile: vi.fn(),
  getSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  toPublicError: vi.fn((_error: unknown, message: string) => ({
    id: 'error-id',
    message
  }))
}))

vi.mock('@/utils/supabase/admin', () => ({ getAdminSupabase }))
vi.mock('@/utils/supabase/queries', () => ({ getProfile, getSupabase }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/utils/errors', () => ({ toPublicError }))

import {
  adminCreateUser,
  changeUserRole,
  deleteUser,
  toggleUserStatus
} from '@/app/actions/user'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CREATED_ID = '33333333-3333-4333-8333-333333333333'

function createForm(password = 'password') {
  const formData = new FormData()
  formData.set('email', 'member@example.com')
  formData.set('password', password)
  formData.set('role', 'editor')
  formData.set('is_active', 'true')
  return formData
}

function adminClient(options?: {
  createError?: unknown
  profileError?: unknown
  cleanupDeleteError?: unknown
  reserveData?: { role: string; previous_is_active: boolean } | null
  reserveError?: unknown
  reserveSequence?: Array<{ data: unknown; error: unknown }>
  restoreError?: unknown
  deleteError?: unknown
}) {
  const reserveSequence = [...(options?.reserveSequence ?? [])]
  const createUser = vi.fn().mockResolvedValue(
    options?.createError
      ? { data: { user: null }, error: options.createError }
      : { data: { user: { id: CREATED_ID } }, error: null }
  )
  const deleteAuthUser = vi.fn().mockImplementation((userId: string) =>
    Promise.resolve({
      data: {},
      error:
        userId === CREATED_ID
          ? (options?.cleanupDeleteError ?? null)
          : (options?.deleteError ?? null)
    })
  )
  const upsert = vi
    .fn()
    .mockResolvedValue({ error: options?.profileError ?? null })
  const rpc = vi.fn().mockImplementation((fn: string) => {
    if (fn === 'reserve_admin_user_deletion') {
      if (reserveSequence.length > 0) {
        return Promise.resolve(reserveSequence.shift())
      }
      return Promise.resolve({
        data:
          options?.reserveData === undefined
            ? [{ role: 'member', previous_is_active: true }]
            : options.reserveData
              ? [options.reserveData]
              : [],
        error: options?.reserveError ?? null
      })
    }
    if (fn === 'restore_admin_user_deletion_reservation') {
      return Promise.resolve({
        data: null,
        error: options?.restoreError ?? null
      })
    }
    return Promise.resolve({ data: null, error: null })
  })
  const from = vi.fn(() => ({ upsert }))

  return {
    client: {
      auth: { admin: { createUser, deleteUser: deleteAuthUser } },
      from,
      rpc
    },
    createUser,
    deleteAuthUser,
    upsert,
    rpc
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getProfile.mockResolvedValue({ id: ADMIN_ID, role: 'admin', is_active: true })
})

describe('active administrator authorization', () => {
  test.each([
    ['unauthenticated', null],
    ['inactive administrator', { id: ADMIN_ID, role: 'admin', is_active: false }],
    ['editor', { id: ADMIN_ID, role: 'editor', is_active: true }],
    ['member', { id: ADMIN_ID, role: 'member', is_active: true }]
  ])('rejects %s before any privileged client call', async (_name, profile) => {
    getProfile.mockResolvedValue(profile)

    const results = await Promise.all([
      adminCreateUser(createForm()),
      deleteUser(TARGET_ID),
      changeUserRole(TARGET_ID, 'editor'),
      toggleUserStatus(TARGET_ID, false)
    ])

    expect(results).toEqual([
      { error: 'Từ chối truy cập.' },
      { error: 'Từ chối truy cập.' },
      { error: 'Từ chối truy cập.' },
      { error: 'Từ chối truy cập.' }
    ])
    expect(getAdminSupabase).not.toHaveBeenCalled()
    expect(getSupabase).not.toHaveBeenCalled()
  })
})

describe('admin user creation', () => {
  test('creates through Auth Admin API then upserts the profile', async () => {
    const mocks = adminClient()
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await adminCreateUser(createForm())

    expect(result).toEqual({ success: true })
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'password',
      email_confirm: true
    })
    expect(mocks.upsert).toHaveBeenCalledWith({
      id: CREATED_ID,
      role: 'editor',
      is_active: true
    })
    expect(mocks.createUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsert.mock.invocationCallOrder[0]
    )
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/users')
  })

  test('deletes the Auth user when profile upsert fails', async () => {
    const mocks = adminClient({ profileError: new Error('profile failed') })
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await adminCreateUser(createForm())

    expect(result).toEqual({
      error: 'Không thể tạo hồ sơ người dùng.',
      errorId: 'error-id'
    })
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith(CREATED_ID)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test('reports a distinct public error when compensation auth deletion also fails', async () => {
    const mocks = adminClient({
      profileError: new Error('profile failed'),
      cleanupDeleteError: new Error('cleanup failed')
    })
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await adminCreateUser(createForm())

    expect(result).toEqual({
      error: 'Không thể hoàn tất việc dọn dẹp tài khoản sau khi tạo thất bại.',
      errorId: 'error-id'
    })
    expect(toPublicError).toHaveBeenCalledWith(
      expect.any(Error),
      'Không thể hoàn tất việc dọn dẹp tài khoản sau khi tạo thất bại.',
      expect.objectContaining({ event: 'user.create.cleanup_failed' })
    )
  })

  test('requires an eight-character password before using Admin API', async () => {
    const mocks = adminClient()
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await adminCreateUser(createForm('1234567'))

    expect(result).toEqual({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})

describe('admin user deletion', () => {
  test('rejects deleting the current administrator before Admin API', async () => {
    const mocks = adminClient()
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await deleteUser(ADMIN_ID)

    expect(result).toEqual({ error: 'Không thể tự xoá tài khoản của bạn.' })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled()
  })

  test('rejects deleting the last active administrator via atomic reservation', async () => {
    const mocks = adminClient({
      reserveError: new Error('Cannot remove the last active administrator.')
    })
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await deleteUser(TARGET_ID)

    expect(result).toEqual({
      error: 'Không thể xoá quản trị viên đang hoạt động cuối cùng.'
    })
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled()
  })

  test('rolls back the winning reservation when concurrent deletion loses safety', async () => {
    const mocks = adminClient({
      reserveSequence: [
        {
          data: [{ role: 'admin', previous_is_active: true }],
          error: null
        },
        {
          data: null,
          error: new Error('Cannot remove the last active administrator.')
        }
      ],
      deleteError: new Error('Auth delete failed')
    })
    getAdminSupabase.mockReturnValue(mocks.client)

    const [firstResult, secondResult] = await Promise.all([
      deleteUser(TARGET_ID),
      deleteUser(ADMIN_ID.replace('11111111', '44444444'))
    ])

    expect(firstResult).toEqual({
      error: 'Không thể xoá người dùng lúc này. Vui lòng thử lại.',
      errorId: 'error-id',
      retryable: true
    })
    expect(secondResult).toEqual({
      error: 'Không thể xoá quản trị viên đang hoạt động cuối cùng.'
    })
    expect(mocks.rpc).toHaveBeenCalledWith('reserve_admin_user_deletion', {
      target_user_id: TARGET_ID
    })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'restore_admin_user_deletion_reservation',
      {
        target_user_id: TARGET_ID,
        restore_is_active: true
      }
    )
  })

  test('deletes user after atomic reservation succeeds', async () => {
    const mocks = adminClient({
      reserveData: { role: 'member', previous_is_active: true }
    })
    getAdminSupabase.mockReturnValue(mocks.client)

    const result = await deleteUser(TARGET_ID)

    expect(result).toEqual({ success: true })
    expect(mocks.rpc).toHaveBeenCalledWith('reserve_admin_user_deletion', {
      target_user_id: TARGET_ID
    })
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith(TARGET_ID)
  })
})
