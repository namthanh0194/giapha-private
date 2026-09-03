'use client'

import {
  approveChangeRequest,
  rejectChangeRequest,
  withdrawChangeRequest,
  type ChangeRequestTarget,
  type NotificationStatus
} from '@/app/actions/change-requests'
import { Check, Clock, X, Undo2 } from 'lucide-react'
import { useState, useTransition } from 'react'

export interface ChangeRequestItem {
  id: string
  target_table: ChangeRequestTarget
  target_id: string
  operation: 'INSERT' | 'UPDATE'
  proposed_data: Record<string, unknown>
  current_data: Record<string, unknown> | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  requester_id: string
  reviewer_id: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
  withdrawn_at: string | null
}

const TABLE_LABELS: Record<ChangeRequestTarget, string> = {
  persons: 'Hồ sơ thành viên',
  custom_events: 'Sự kiện gia đình',
  sources: 'Nguồn tư liệu',
  person_citations: 'Trích dẫn tư liệu'
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
  is_deceased: 'Đã mất',
  other_names: 'Tên gọi khác',
  note: 'Ghi chú',
  name: 'Tên sự kiện',
  content: 'Nội dung',
  event_date: 'Ngày diễn ra',
  location: 'Địa điểm',
  title: 'Tên tư liệu',
  source_type: 'Loại tư liệu',
  author: 'Tác giả',
  publisher: 'Nhà xuất bản',
  publication_date: 'Ngày xuất bản',
  url: 'Đường dẫn',
  repository: 'Nơi lưu trữ',
  field_name: 'Trường liên quan',
  page_reference: 'Trang tham chiếu',
  quotation: 'Đoạn trích',
  confidence: 'Độ tin cậy'
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Trống'
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  return String(value)
}

export default function ChangeRequestList({
  requests,
  currentUserId,
  canReview
}: {
  requests: ChangeRequestItem[]
  currentUserId: string
  canReview: boolean
}) {
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatus | null>(null)
  const [, startTransition] = useTransition()

  if (requests.length === 0) {
    return (
      <div className='rounded-3xl border border-border bg-surface p-8 text-center'>
        <Clock className='mx-auto size-8 text-secondary' aria-hidden='true' />
        <p className='mt-2 text-sm text-secondary'>
          Hiện không có đề xuất nào cần xử lý.
        </p>
      </div>
    )
  }

  function handleApprove(item: ChangeRequestItem) {
    const changesList = Object.keys(item.proposed_data)
      .filter((k) => k !== 'id')
      .map(
        (k) => `${FIELD_LABELS[k] ?? k}: ${renderValue(item.proposed_data[k])}`
      )
      .join('\n')
    const confirmed = window.confirm(
      `Xác nhận áp dụng đề xuất này vào cơ sở dữ liệu?\n\nCác thay đổi sẽ được ghi nhận:\n${changesList}`
    )
    if (!confirmed) return

    setPendingId(item.id)
    setFeedback(null)
    setNotificationStatus(null)
    startTransition(async () => {
      const note = noteInputs[item.id] || ''
      const result = await approveChangeRequest(item.id, note)
      setPendingId(null)
      if (!result.success) {
        setFeedback(result.error ?? 'Không thể duyệt đề xuất.')
        return
      }
      setFeedback('Đã duyệt và áp dụng đề xuất thành công.')
      if (result.notification) setNotificationStatus(result.notification)
    })
  }

  function handleReject(id: string) {
    const note = (noteInputs[id] || '').trim()
    if (!note) {
      setFeedback('Vui lòng nhập lý do từ chối vào ô ghi chú.')
      return
    }

    setPendingId(id)
    setFeedback(null)
    setNotificationStatus(null)
    startTransition(async () => {
      const result = await rejectChangeRequest(id, note)
      setPendingId(null)
      if (!result.success) {
        setFeedback(result.error ?? 'Không thể từ chối đề xuất.')
        return
      }
      setFeedback('Đã từ chối đề xuất.')
      if (result.notification) setNotificationStatus(result.notification)
    })
  }

  function handleWithdraw(id: string) {
    const confirmed = window.confirm('Bạn có chắc muốn rút lại đề xuất này?')
    if (!confirmed) return

    setPendingId(id)
    setFeedback(null)
    startTransition(async () => {
      const result = await withdrawChangeRequest(id)
      setPendingId(null)
      if (!result.success) {
        setFeedback(result.error ?? 'Không thể rút đề xuất.')
        return
      }
      setFeedback('Đã rút lại đề xuất.')
    })
  }

  return (
    <div className='space-y-6'>
      {feedback && (
        <div
          className='rounded-xl border border-border bg-surface p-4 text-sm text-primary'
          role='status'>
          <p className='font-medium'>{feedback}</p>
          {notificationStatus && (
            <p className='mt-1 text-secondary'>
              {notificationStatus.sent
                ? 'Email thông báo đã gửi tới người đề xuất.'
                : notificationStatus.configured
                  ? 'Không thể gửi email thông báo (đã ghi log).'
                  : 'Hệ thống chưa cấu hình dịch vụ gửi email.'}
            </p>
          )}
        </div>
      )}

      {requests.map((item) => {
        const isPending = item.status === 'pending'
        const isOwn = item.requester_id === currentUserId
        const proposedKeys = Object.keys(item.proposed_data).filter(
          (k) => k !== 'id'
        )

        return (
          <article
            key={item.id}
            className='rounded-3xl border border-border bg-surface p-6 backdrop-blur-xl'
            aria-labelledby={`cr-heading-${item.id}`}>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4'>
              <div>
                <h2
                  id={`cr-heading-${item.id}`}
                  className='font-serif text-lg font-semibold text-primary'>
                  {TABLE_LABELS[item.target_table]} ·{' '}
                  {item.operation === 'INSERT' ? 'Thêm mới' : 'Hiệu chỉnh'}
                </h2>
                <p className='mt-0.5 text-sm text-secondary'>
                  Tạo lúc {new Date(item.created_at).toLocaleString('vi-VN')}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  item.status === 'pending'
                    ? 'bg-tertiary/10 text-primary'
                    : item.status === 'approved'
                      ? 'bg-stone-100 text-primary'
                      : item.status === 'rejected'
                        ? 'bg-error/10 text-error'
                        : 'bg-stone-100 text-stone-700'
                }`}>
                {item.status === 'pending'
                  ? 'Chờ duyệt'
                  : item.status === 'approved'
                    ? 'Đã duyệt'
                    : item.status === 'rejected'
                      ? 'Từ chối'
                      : 'Đã rút'}
              </span>
            </div>

            <div className='mt-4 overflow-x-auto'>
              <table className='w-full min-w-[32rem] text-left text-sm'>
                <thead className='border-b border-border text-secondary'>
                  <tr>
                    <th className='pb-2 font-medium'>Trường</th>
                    <th className='pb-2 font-medium'>Dữ liệu hiện tại</th>
                    <th className='pb-2 font-medium'>Dữ liệu đề xuất</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {proposedKeys.map((key) => {
                    const before = item.current_data
                      ? renderValue(item.current_data[key])
                      : 'Không có'
                    const after = renderValue(item.proposed_data[key])
                    const isChanged = before !== after
                    return (
                      <tr key={key} className='align-top'>
                        <td className='py-2.5 font-medium text-primary'>
                          {FIELD_LABELS[key] ?? key}
                        </td>
                        <td className='py-2.5 text-secondary'>{before}</td>
                        <td
                          className={`py-2.5 font-medium ${isChanged ? 'text-tertiary' : 'text-primary'}`}>
                          {after}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {item.review_note && (
              <div className='mt-4 rounded-xl border border-border bg-neutral p-3 text-sm'>
                <p className='font-medium text-primary'>Ghi chú rà soát:</p>
                <p className='mt-0.5 text-secondary'>{item.review_note}</p>
              </div>
            )}

            {isPending && (
              <div className='mt-5 space-y-3 border-t border-border pt-4'>
                {canReview && (
                  <div>
                    <label
                      htmlFor={`note-${item.id}`}
                      className='block text-sm font-medium text-primary'>
                      Ghi chú phản hồi (bắt buộc khi từ chối):
                    </label>
                    <input
                      id={`note-${item.id}`}
                      type='text'
                      value={noteInputs[item.id] || ''}
                      onChange={(event) =>
                        setNoteInputs((prev) => ({
                          ...prev,
                          [item.id]: event.target.value
                        }))
                      }
                      placeholder='Nhập ghi chú cho thành viên...'
                      className='mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary focus:ring-2 focus:ring-tertiary focus:outline-none'
                    />
                  </div>
                )}

                <div className='flex flex-wrap items-center gap-3'>
                  {canReview && (
                    <>
                      <button
                        type='button'
                        onClick={() => handleApprove(item)}
                        disabled={pendingId === item.id}
                        className='inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-surface transition-colors hover:bg-stone-800 disabled:opacity-50'>
                        <Check className='size-4' aria-hidden='true' />
                        Duyệt và áp dụng
                      </button>
                      <button
                        type='button'
                        onClick={() => handleReject(item.id)}
                        disabled={pendingId === item.id}
                        className='inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50'>
                        <X className='size-4' aria-hidden='true' />
                        Từ chối
                      </button>
                    </>
                  )}
                  {isOwn && (
                    <button
                      type='button'
                      onClick={() => handleWithdraw(item.id)}
                      disabled={pendingId === item.id}
                      className='inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-neutral disabled:opacity-50'>
                      <Undo2 className='size-4' aria-hidden='true' />
                      Rút lại đề xuất
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
