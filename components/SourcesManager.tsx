'use client'

import SourceModal from '@/components/modal/SourceModal'
import { PersonCitation, Source } from '@/types'
import { createClient } from '@/utils/supabase/client'
import { BookOpen, ExternalLink, FileText, Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

const fieldLabels: Record<string, string> = {
  birth_date: 'Ngày sinh',
  death_date: 'Ngày mất',
  relationship: 'Quan hệ gia đình',
  note: 'Ghi chú',
  other: 'Thông tin khác',
  none: 'Thông tin chung'
}

const confidenceLabels: Record<PersonCitation['confidence'], string> = {
  primary: 'Nguồn sơ cấp',
  secondary: 'Nguồn thứ cấp',
  uncertain: 'Cần kiểm chứng'
}

interface SourcesManagerProps {
  personId: string
  canEdit: boolean
}

export default function SourcesManager({
  personId,
  canEdit
}: SourcesManagerProps) {
  const [citations, setCitations] = useState<PersonCitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCitation, setSelectedCitation] = useState<
    PersonCitation | undefined
  >()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const loadCitations = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: queryError } = await supabase
      .from('person_citations')
      .select(
        'id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by, created_at, source:sources(id, title, source_type, author, publisher, publication_date, url, repository, note, created_by, created_at, updated_at)'
      )
      .eq('person_id', personId)
      .order('field_name', { ascending: true })
      .order('created_at', { ascending: true })

    if (queryError) {
      setError('Không thể tải nguồn tư liệu.')
    } else {
      setCitations((data ?? []) as unknown as PersonCitation[])
    }
    setLoading(false)
  }, [personId])

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadCitations()
    }, 0)
    return () => window.clearTimeout(loadTimer)
  }, [loadCitations])

  const groups = useMemo(() => {
    return citations.reduce<Record<string, PersonCitation[]>>(
      (result, citation) => {
        const key = citation.field_name ?? 'none'
        result[key] = [...(result[key] ?? []), citation]
        return result
      },
      {}
    )
  }, [citations])

  const openNewCitation = () => {
    setSelectedCitation(undefined)
    setIsModalOpen(true)
  }

  const openEditCitation = (citation: PersonCitation) => {
    setSelectedCitation(citation)
    setIsModalOpen(true)
  }

  return (
    <section aria-labelledby='sources-heading'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2
            id='sources-heading'
            className='flex items-center gap-2 text-base font-semibold text-stone-800 sm:text-lg'>
            <BookOpen className='size-5 text-amber-600' />
            Nguồn tư liệu
          </h2>
          <p className='mt-1 text-sm text-stone-500'>
            Tài liệu và lời kể dùng để đối chiếu thông tin thành viên.
          </p>
        </div>
        {canEdit && (
          <button
            type='button'
            onClick={openNewCitation}
            className='btn-primary'>
            <Plus className='size-4' />
            Thêm nguồn
          </button>
        )}
      </div>

      <div className='rounded-2xl border border-stone-200/60 bg-white/80 p-5 backdrop-blur-sm sm:p-6'>
        {loading ? (
          <p className='text-sm text-stone-500'>Đang tải nguồn tư liệu...</p>
        ) : error ? (
          <p role='alert' className='text-sm text-error'>
            {error}
          </p>
        ) : citations.length === 0 ? (
          <p className='text-sm text-stone-500'>Chưa có nguồn tư liệu.</p>
        ) : (
          <div className='space-y-6'>
            {Object.entries(groups).map(([field, items]) => (
              <div key={field}>
                <h3 className='mb-3 text-sm font-semibold text-stone-700'>
                  {fieldLabels[field]}
                </h3>
                <ul className='space-y-3'>
                  {items.map((citation) => {
                    const source: Source = citation.source
                    return (
                      <li
                        key={citation.id}
                        className='rounded-xl bg-stone-50 p-4'>
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <p className='flex items-center gap-1.5 text-sm font-medium text-stone-800'>
                              <FileText className='size-4 shrink-0 text-stone-500' />
                              {source.title}
                            </p>
                            {(source.author ||
                              source.publication_date ||
                              citation.page_reference) && (
                              <p className='mt-1 text-sm text-stone-500'>
                                {[
                                  source.author,
                                  source.publication_date,
                                  citation.page_reference
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            )}
                          </div>
                          {canEdit && (
                            <button
                              type='button'
                              onClick={() => openEditCitation(citation)}
                              className='rounded-full p-2 text-secondary transition hover:bg-surface focus:ring-2 focus:ring-tertiary/40 focus:outline-none'
                              aria-label={`Chỉnh sửa nguồn ${source.title}`}>
                              <Pencil className='size-4' />
                            </button>
                          )}
                        </div>
                        <p className='mt-3 text-sm text-stone-600'>
                          Độ tin cậy:{' '}
                          <span className='font-medium'>
                            {confidenceLabels[citation.confidence]}
                          </span>
                        </p>
                        {citation.quotation && (
                          <blockquote className='mt-2 border-l-2 border-amber-500 pl-3 text-sm whitespace-pre-wrap text-stone-600'>
                            “{citation.quotation}”
                          </blockquote>
                        )}
                        {source.note && (
                          <p className='mt-2 text-sm whitespace-pre-wrap text-stone-500'>
                            {source.note}
                          </p>
                        )}
                        {source.url && (
                          <a
                            href={source.url}
                            target='_blank'
                            rel='noreferrer'
                            className='mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 underline decoration-amber-700/30 underline-offset-4 hover:text-amber-800'>
                            Mở nguồn gốc{' '}
                            <ExternalLink
                              className='size-3.5'
                              aria-hidden='true'
                            />
                          </a>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <SourceModal
          personId={personId}
          citation={selectedCitation}
          onClose={() => setIsModalOpen(false)}
          onSaved={loadCitations}
        />
      )}
    </section>
  )
}
