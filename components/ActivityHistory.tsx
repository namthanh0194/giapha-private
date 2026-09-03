'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { undoAuditEntryAction } from '@/app/actions/audit'
import type { AuditLogEntry, AuditOperation, AuditTableName } from '@/types'

const TABLE_LABELS: Record<AuditTableName, string> = {
  persons: 'Thành viên',
  relationships: 'Quan hệ',
  custom_events: 'Sự kiện',
  gallery_items: 'Thư viện ảnh',
  profiles: 'Tài khoản',
  person_details_private: 'Thông tin riêng tư'
}

const OPERATION_LABELS: Record<AuditOperation, string> = {
  INSERT: 'Tạo mới',
  UPDATE: 'Cập nhật',
  DELETE: 'Xóa',
  MERGE: 'Hợp nhất'
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Họ và tên',
  gender: 'Giới tính',
  birth_year: 'Năm sinh',
  birth_month: 'Tháng sinh',
  birth_day: 'Ngày sinh',
  death_year: 'Năm mất',
  death_month: 'Tháng mất',
  death_day: 'Ngày mất',
  death_lunar_year: 'Năm mất âm lịch',
  death_lunar_month: 'Tháng mất âm lịch',
  death_lunar_day: 'Ngày mất âm lịch',
  is_deceased: 'Trạng thái qua đời',
  is_in_law: 'Thành viên bên ngoại',
  birth_order: 'Thứ tự sinh',
  generation: 'Đời',
  other_names: 'Tên khác',
  avatar_url: 'Ảnh đại diện',
  note: 'Ghi chú',
  person_a: 'Thành viên thứ nhất',
  person_b: 'Thành viên thứ hai',
  type: 'Loại quan hệ',
  name: 'Tên sự kiện',
  content: 'Nội dung',
  event_date: 'Ngày sự kiện',
  location: 'Địa điểm',
  title: 'Tiêu đề',
  description: 'Mô tả',
  image_url: 'Ảnh',
  storage_path: 'Tệp lưu trữ',
  role: 'Vai trò',
  is_active: 'Trạng thái hoạt động',
  phone_number: 'Số điện thoại',
  occupation: 'Nghề nghiệp',
  current_residence: 'Nơi ở hiện tại',
  created_by: 'Người tạo'
}

type Filters = {
  date: string
  actor: string
  operation: AuditOperation | ''
  table: AuditTableName | ''
}

type ActivityHistoryProps = {
  entries: Array<AuditLogEntry & { is_undone?: boolean }>
  page: number
  pageSize: number
  total: number
  filters: Filters
  isAdmin: boolean
  canUndo: boolean
}

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000
const GALLERY_METADATA_FIELDS = new Set(['title', 'description', 'event_date'])

function buildHref(filters: Filters, page: number) {
  const params = new URLSearchParams()
  if (filters.date) params.set('date', filters.date)
  if (filters.actor) params.set('actor', filters.actor)
  if (filters.operation) params.set('operation', filters.operation)
  if (filters.table) params.set('table', filters.table)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? '/dashboard/activity?' + query : '/dashboard/activity'
}

function changedFields(entry: AuditLogEntry) {
  const payload = entry.new_data ?? entry.old_data
  if (!payload) return []
  if (Array.isArray(payload.changed_fields)) {
    return payload.changed_fields.filter(
      (field): field is string => typeof field === 'string'
    )
  }
  return Object.keys(payload).filter(
    (field) => !['id', 'created_at', 'updated_at'].includes(field)
  )
}

function formatOccurredAt(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function isSupportedUndo(entry: AuditLogEntry) {
  if (entry.operation === 'MERGE') return false

  if (Date.now() - new Date(entry.occurred_at).getTime() > UNDO_WINDOW_MS) {
    return false
  }

  if (entry.table_name === 'persons') return entry.operation === 'UPDATE'
  if (entry.table_name === 'relationships') {
    return entry.operation === 'INSERT' || entry.operation === 'DELETE'
  }
  if (entry.table_name === 'custom_events') return true
  if (entry.table_name !== 'gallery_items' || entry.operation !== 'UPDATE') {
    return false
  }

  if (!entry.old_data || !entry.new_data) return false
  return Object.keys(entry.new_data).every(
    (field) =>
      entry.old_data?.[field] === entry.new_data?.[field] ||
      GALLERY_METADATA_FIELDS.has(field)
  )
}

function undoDescription(entry: AuditLogEntry, fieldSummary: string) {
  if (entry.operation === 'INSERT') return 'Xóa bản ghi vừa tạo.'
  if (entry.operation === 'DELETE') return 'Khôi phục bản ghi đã xóa.'
  if (entry.table_name === 'gallery_items') {
    return 'Khôi phục tiêu đề, mô tả và ngày sự kiện; không thay đổi tệp ảnh.'
  }
  return fieldSummary
    ? 'Khôi phục các trường: ' + fieldSummary + '.'
    : 'Khôi phục dữ liệu về trạng thái trước đó.'
}

function UndoAuditForm({
  auditId,
  description
}: {
  auditId: number
  description: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const result = await undoAuditEntryAction(auditId)
        if (!result.success) setError(result.error)
      } catch {
        setError('Không thể hoàn tác thay đổi này.')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className='mt-2 max-w-xs rounded-xl border border-stone-200 bg-stone-50 p-3 sm:ml-auto'>
      <p className='text-sm text-stone-600'>{description}</p>
      <button
        type='submit'
        disabled={isPending}
        className='mt-3 rounded-xl bg-stone-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50'>
        {isPending ? 'Đang hoàn tác...' : 'Xác nhận hoàn tác'}
      </button>
      <p
        aria-live='assertive'
        role={error ? 'alert' : undefined}
        className={error ? 'mt-2 text-sm text-error' : 'sr-only'}>
        {error}
      </p>
    </form>
  )
}

export default function ActivityHistory({
  entries,
  page,
  pageSize,
  total,
  filters,
  isAdmin,
  canUndo
}: ActivityHistoryProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className='rounded-3xl border border-stone-200 bg-white p-4 sm:p-6'>
      <form
        action='/dashboard/activity'
        className='grid gap-3 border-b border-stone-200 pb-5 sm:grid-cols-2 lg:grid-cols-5'>
        <label className='grid gap-1 text-sm font-medium text-stone-700'>
          Ngày
          <input
            name='date'
            type='date'
            defaultValue={filters.date}
            className='rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-amber-500'
          />
        </label>
        <label className='grid gap-1 text-sm font-medium text-stone-700'>
          Người thực hiện
          <input
            name='actor'
            defaultValue={filters.actor}
            placeholder='UUID người dùng'
            className='rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-amber-500'
          />
        </label>
        <label className='grid gap-1 text-sm font-medium text-stone-700'>
          Thao tác
          <select
            name='operation'
            defaultValue={filters.operation}
            className='rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-amber-500'>
            <option value=''>Tất cả thao tác</option>
            {Object.entries(OPERATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className='grid gap-1 text-sm font-medium text-stone-700'>
          Dữ liệu
          <select
            name='table'
            defaultValue={filters.table}
            className='rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-amber-500'>
            <option value=''>Tất cả dữ liệu</option>
            {Object.entries(TABLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className='flex items-end gap-2'>
          <button
            type='submit'
            className='inline-flex min-h-11 items-center rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800'>
            Lọc
          </button>
          <Link
            href='/dashboard/activity'
            className='inline-flex min-h-11 items-center rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50'>
            Xóa lọc
          </Link>
        </div>
      </form>

      <div className='divide-y divide-stone-100'>
        {entries.length === 0 ? (
          <p className='py-10 text-center text-sm text-stone-500'>
            Không có hoạt động phù hợp.
          </p>
        ) : (
          entries.map((entry) => {
            const fields = changedFields(entry)
            const isRedacted =
              entry.new_data?.redacted === true ||
              entry.old_data?.redacted === true
            const fieldSummary = fields
              .map((field) => FIELD_LABELS[field] ?? field)
              .join(', ')
            const canUndoEntry =
              canUndo && !entry.is_undone && isSupportedUndo(entry)

            return (
              <article
                key={entry.id}
                className='grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
                <div>
                  <p className='text-sm font-medium text-stone-900'>
                    {OPERATION_LABELS[entry.operation]}{' '}
                    {TABLE_LABELS[entry.table_name]}
                  </p>
                  <p className='mt-1 text-sm text-stone-500'>
                    {isRedacted && !isAdmin
                      ? 'Thông tin nhạy cảm đã được che.'
                      : fieldSummary
                        ? 'Trường liên quan: ' + fieldSummary
                        : 'Không có trường dữ liệu để hiển thị.'}
                  </p>
                  <p className='mt-1 text-sm break-all text-stone-400'>
                    Mã bản ghi: {entry.record_id}
                  </p>
                </div>
                <div className='text-sm text-stone-500 sm:text-right'>
                  <p>{formatOccurredAt(entry.occurred_at)}</p>
                  <p className='mt-1 break-all'>
                    Người thực hiện: {entry.actor_user_id ?? 'Hệ thống'}
                  </p>
                  {canUndoEntry && (
                    <details className='mt-2 text-left sm:text-right'>
                      <summary className='cursor-pointer text-sm font-medium text-stone-700 hover:text-stone-900'>
                        Hoàn tác
                      </summary>
                      <UndoAuditForm
                        auditId={entry.id}
                        description={undoDescription(entry, fieldSummary)}
                      />
                    </details>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>

      {total > 0 && (
        <div className='mt-5 flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-5 sm:flex-row'>
          <p className='text-sm text-stone-500'>
            Hiển thị {(page - 1) * pageSize + 1} -{' '}
            {Math.min(page * pageSize, total)} trên tổng số {total} hoạt động
          </p>
          <div className='flex items-center gap-2'>
            {page > 1 ? (
              <Link
                href={buildHref(filters, page - 1)}
                className='inline-flex min-h-11 items-center rounded-xl border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50'>
                Trang trước
              </Link>
            ) : (
              <span className='rounded-xl border border-stone-200 px-3 py-1.5 text-sm text-stone-400'>
                Trang trước
              </span>
            )}
            <span className='text-sm text-stone-600'>
              Trang {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildHref(filters, page + 1)}
                className='inline-flex min-h-11 items-center rounded-xl border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50'>
                Trang sau
              </Link>
            ) : (
              <span className='rounded-xl border border-stone-200 px-3 py-1.5 text-sm text-stone-400'>
                Trang sau
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
