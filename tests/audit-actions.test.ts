import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isSupportedUndo } from '@/components/ActivityHistory'
import type { AuditLogEntry } from '@/types'

const { getProfile, getSupabase, revalidatePath, toPublicError } = vi.hoisted(
  () => ({
    getProfile: vi.fn(),
    getSupabase: vi.fn(),
    revalidatePath: vi.fn(),
    toPublicError: vi.fn((_error: unknown, message: string) => ({
      id: 'error-id',
      message
    }))
  })
)

vi.mock('@/utils/supabase/queries', () => ({ getProfile, getSupabase }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/utils/errors', () => ({ toPublicError }))

import { undoAuditEntryAction } from '@/app/actions/audit'

beforeEach(() => {
  vi.clearAllMocks()
  getProfile.mockResolvedValue({ role: 'editor', is_active: true })
})

describe('undoAuditEntryAction', () => {
  test('rejects invalid ids before authentication or RPC calls', async () => {
    await expect(undoAuditEntryAction(0)).resolves.toEqual({
      success: false,
      error: 'Mã lịch sử không hợp lệ.'
    })
    expect(getProfile).not.toHaveBeenCalled()
    expect(getSupabase).not.toHaveBeenCalled()
  })

  test.each([
    ['unauthenticated', null],
    ['inactive editor', { role: 'editor', is_active: false }],
    ['member', { role: 'member', is_active: true }]
  ])('rejects %s before RPC', async (_name, profile) => {
    getProfile.mockResolvedValue(profile)

    await expect(undoAuditEntryAction(42)).resolves.toEqual({
      success: false,
      error: 'Từ chối truy cập.'
    })
    expect(getSupabase).not.toHaveBeenCalled()
  })

  test('calls the RPC and revalidates the affected pages', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { success: true, table_name: 'custom_events' },
      error: null
    })
    getSupabase.mockResolvedValue({ rpc })

    await expect(undoAuditEntryAction(42)).resolves.toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('undo_audit_entry', { audit_id: 42 })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/activity')
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/events')
  })

  test('returns a public error when the RPC rejects the undo', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('conflict') })
    getSupabase.mockResolvedValue({ rpc })

    await expect(undoAuditEntryAction(42)).resolves.toEqual({
      success: false,
      error: 'Không thể hoàn tác thay đổi này.',
      errorId: 'error-id'
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test('returns a public error when the RPC reports an unsuccessful result', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { success: false }, error: null })
    getSupabase.mockResolvedValue({ rpc })

    await expect(undoAuditEntryAction(42)).resolves.toEqual({
      success: false,
      error: 'Không thể hoàn tác thay đổi này.',
      errorId: 'error-id'
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('isSupportedUndo', () => {
  test('never permits undoing a MERGE audit entry', () => {
    const entry: AuditLogEntry = {
      id: 1,
      occurred_at: new Date().toISOString(),
      table_name: 'persons',
      record_id: '41000000-0000-4000-8000-000000000001',
      operation: 'MERGE',
      actor_user_id: 'a4000000-0000-4000-8000-000000000001',
      old_data: null,
      new_data: { action: 'merge_person_records', cannot_undo: true }
    }

    expect(isSupportedUndo(entry)).toBe(false)
  })
})
