'use client'

import { saveSourceCitation } from '@/app/actions/sources'
import {
  CitationConfidence,
  CitationFieldName,
  PersonCitation,
  SourceType
} from '@/types'
import { Loader2, X } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'

const sourceTypes: { value: SourceType; label: string }[] = [
  { value: 'document', label: 'Tài liệu' },
  { value: 'book', label: 'Sách' },
  { value: 'oral_history', label: 'Lời kể' },
  { value: 'website', label: 'Website' },
  { value: 'photo', label: 'Ảnh' },
  { value: 'other', label: 'Khác' }
]

const citationFields: { value: CitationFieldName | 'none'; label: string }[] = [
  { value: 'birth_date', label: 'Ngày sinh' },
  { value: 'death_date', label: 'Ngày mất' },
  { value: 'relationship', label: 'Quan hệ gia đình' },
  { value: 'note', label: 'Ghi chú' },
  { value: 'other', label: 'Thông tin khác' },
  { value: 'none', label: 'Thông tin chung' }
]

const confidenceOptions: { value: CitationConfidence; label: string }[] = [
  { value: 'primary', label: 'Nguồn sơ cấp' },
  { value: 'secondary', label: 'Nguồn thứ cấp' },
  { value: 'uncertain', label: 'Cần kiểm chứng' }
]

interface SourceModalProps {
  personId: string
  citation?: PersonCitation
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function SourceModal({
  personId,
  citation,
  onClose,
  onSaved
}: SourceModalProps) {
  const source = citation?.source
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  const loadingRef = useRef(false)
  const [title, setTitle] = useState(source?.title ?? '')
  const [sourceType, setSourceType] = useState<SourceType>(
    source?.source_type ?? 'document'
  )
  const [author, setAuthor] = useState(source?.author ?? '')
  const [publisher, setPublisher] = useState(source?.publisher ?? '')
  const [publicationDate, setPublicationDate] = useState(
    source?.publication_date ?? ''
  )
  const [url, setUrl] = useState(source?.url ?? '')
  const [repository, setRepository] = useState(source?.repository ?? '')
  const [sourceNote, setSourceNote] = useState(source?.note ?? '')
  const [fieldName, setFieldName] = useState<CitationFieldName | 'none'>(
    citation?.field_name ?? 'none'
  )
  const [pageReference, setPageReference] = useState(
    citation?.page_reference ?? ''
  )
  const [quotation, setQuotation] = useState(citation?.quotation ?? '')
  const [confidence, setConfidence] = useState<CitationConfidence>(
    citation?.confidence ?? 'uncertain'
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  useEffect(() => {
    const returnFocus = document.activeElement
    const focusTimer = window.setTimeout(
      () => titleInputRef.current?.focus(),
      0
    )
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      )
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      if (returnFocus instanceof HTMLElement) returnFocus.focus()
    }
  }, [])

  const inputClasses =
    'w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm text-primary outline-none transition focus:border-tertiary focus:ring-2 focus:ring-tertiary/20 disabled:cursor-not-allowed disabled:bg-neutral'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setError('Vui lòng nhập tiêu đề nguồn tư liệu.')
      return
    }

    setLoading(true)
    setError(null)
    const sourcePayload = {
      title: normalizedTitle,
      source_type: sourceType,
      author: author.trim() || null,
      publisher: publisher.trim() || null,
      publication_date: publicationDate || null,
      url: url.trim() || null,
      repository: repository.trim() || null,
      note: sourceNote.trim() || null
    }
    const citationPayload = {
      person_id: personId,
      field_name: fieldName === 'none' ? null : fieldName,
      page_reference: pageReference.trim() || null,
      quotation: quotation.trim() || null,
      confidence
    }

    try {
      const result = await saveSourceCitation({
        sourceId: citation?.source_id,
        citationId: citation?.id,
        expectedSourceVersion: citation?.source.version,
        expectedCitationVersion: citation?.version,
        source: sourcePayload,
        citation: citationPayload
      })
      if ('error' in result) {
        setError(result.error ?? 'Không thể lưu nguồn tư liệu.')
        return
      }

      await onSaved()
      onClose()
    } catch {
      setError('Không thể lưu nguồn tư liệu. Vui lòng kiểm tra lại và thử lại.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-end bg-stone-900/40 p-0 sm:items-center sm:justify-center sm:p-6'>
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='source-modal-title'
        aria-describedby={error ? 'source-modal-error' : undefined}
        tabIndex={-1}
        className='max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-soft outline-none sm:max-w-2xl sm:rounded-3xl sm:p-6'>
        <div className='mb-6 flex items-start justify-between gap-4'>
          <div>
            <h2
              id='source-modal-title'
              className='text-base font-semibold text-primary'>
              {citation ? 'Chỉnh sửa nguồn tư liệu' : 'Thêm nguồn tư liệu'}
            </h2>
            <p className='mt-1 text-sm text-secondary'>
              Ghi rõ nguồn và mức độ tin cậy của thông tin.
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            disabled={loading}
            className='rounded-full p-2 text-secondary transition hover:bg-neutral focus:ring-2 focus:ring-tertiary/40 focus:outline-none disabled:cursor-not-allowed'
            aria-label='Đóng hộp thoại nguồn tư liệu'>
            <X className='size-5' />
          </button>
        </div>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div>
            <label
              htmlFor='source-title'
              className='mb-1.5 block text-sm font-medium text-primary'>
              Tiêu đề nguồn tư liệu
            </label>
            <input
              ref={titleInputRef}
              id='source-title'
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              className={inputClasses}
            />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <label
                htmlFor='source-type'
                className='mb-1.5 block text-sm font-medium text-primary'>
                Loại nguồn
              </label>
              <select
                id='source-type'
                value={sourceType}
                onChange={(event) =>
                  setSourceType(event.target.value as SourceType)
                }
                className={inputClasses}>
                {sourceTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor='source-publication-date'
                className='mb-1.5 block text-sm font-medium text-primary'>
                Ngày xuất bản
              </label>
              <input
                id='source-publication-date'
                type='date'
                value={publicationDate}
                onChange={(event) => setPublicationDate(event.target.value)}
                className={inputClasses}
              />
            </div>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <label
                htmlFor='source-author'
                className='mb-1.5 block text-sm font-medium text-primary'>
                Tác giả
              </label>
              <input
                id='source-author'
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                maxLength={300}
                className={inputClasses}
              />
            </div>
            <div>
              <label
                htmlFor='source-publisher'
                className='mb-1.5 block text-sm font-medium text-primary'>
                Nhà xuất bản
              </label>
              <input
                id='source-publisher'
                value={publisher}
                onChange={(event) => setPublisher(event.target.value)}
                maxLength={300}
                className={inputClasses}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor='source-url'
              className='mb-1.5 block text-sm font-medium text-primary'>
              Liên kết
            </label>
            <input
              id='source-url'
              type='url'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={2048}
              placeholder='https://...'
              className={inputClasses}
            />
          </div>

          <div>
            <label
              htmlFor='source-repository'
              className='mb-1.5 block text-sm font-medium text-primary'>
              Nơi lưu trữ
            </label>
            <input
              id='source-repository'
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              maxLength={500}
              className={inputClasses}
            />
          </div>

          <div>
            <label
              htmlFor='citation-field'
              className='mb-1.5 block text-sm font-medium text-primary'>
              Thông tin được dẫn chứng
            </label>
            <select
              id='citation-field'
              value={fieldName}
              onChange={(event) =>
                setFieldName(event.target.value as CitationFieldName | 'none')
              }
              className={inputClasses}>
              {citationFields.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <label
                htmlFor='citation-page'
                className='mb-1.5 block text-sm font-medium text-primary'>
                Trang hoặc vị trí
              </label>
              <input
                id='citation-page'
                value={pageReference}
                onChange={(event) => setPageReference(event.target.value)}
                maxLength={300}
                className={inputClasses}
              />
            </div>
            <div>
              <label
                htmlFor='citation-confidence'
                className='mb-1.5 block text-sm font-medium text-primary'>
                Độ tin cậy
              </label>
              <select
                id='citation-confidence'
                value={confidence}
                onChange={(event) =>
                  setConfidence(event.target.value as CitationConfidence)
                }
                className={inputClasses}>
                {confidenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor='citation-quotation'
              className='mb-1.5 block text-sm font-medium text-primary'>
              Trích dẫn
            </label>
            <textarea
              id='citation-quotation'
              rows={3}
              value={quotation}
              onChange={(event) => setQuotation(event.target.value)}
              maxLength={5000}
              className={`${inputClasses} resize-y`}
            />
          </div>

          <div>
            <label
              htmlFor='source-note'
              className='mb-1.5 block text-sm font-medium text-primary'>
              Ghi chú về nguồn
            </label>
            <textarea
              id='source-note'
              rows={3}
              value={sourceNote}
              onChange={(event) => setSourceNote(event.target.value)}
              maxLength={5000}
              className={`${inputClasses} resize-y`}
            />
          </div>

          {error && (
            <p
              id='source-modal-error'
              role='alert'
              className='text-sm text-error'>
              {error}
            </p>
          )}

          <div className='flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end'>
            <button
              type='button'
              onClick={onClose}
              disabled={loading}
              className='btn'>
              Huỷ
            </button>
            <button type='submit' disabled={loading} className='btn-primary'>
              {loading && <Loader2 className='size-4 animate-spin' />}
              {loading ? 'Đang lưu...' : 'Lưu nguồn tư liệu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
