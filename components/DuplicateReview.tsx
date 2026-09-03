'use client'

import { mergeDuplicatePersons, type DuplicateCandidate } from '@/app/actions/duplicates'
import { getDuplicateConflicts, type DuplicateFieldKey, type DuplicatePerson } from '@/utils/duplicates'
import { AlertTriangle, GitMerge, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

function valueOf(person: DuplicatePerson, key: DuplicateFieldKey) {
  const value = person[key]
  return value === null || value === undefined || value === '' ? 'Chưa có' : String(value)
}

function relationshipLabel(type: string, direction: 'incoming' | 'outgoing') {
  if (type === 'marriage') return 'Vợ/chồng'
  if (type === 'biological_child') return direction === 'outgoing' ? 'Con ruột' : 'Cha/mẹ ruột'
  if (type === 'adopted_child') return direction === 'outgoing' ? 'Con nuôi' : 'Cha/mẹ nuôi'
  return type
}

function sameCandidate(left: DuplicateCandidate, right: DuplicateCandidate) {
  return left.primary.id === right.primary.id && left.duplicate.id === right.duplicate.id
}

export default function DuplicateReview({ candidates }: { candidates: DuplicateCandidate[] }) {
  const router = useRouter()
  const [active, setActive] = useState<DuplicateCandidate | null>(candidates[0] ?? null)
  const [previousCandidates, setPreviousCandidates] = useState(candidates)
  const [choices, setChoices] = useState<Record<string, 'primary' | 'duplicate'>>({})
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  if (candidates !== previousCandidates) {
    const nextActive = active
      ? candidates.find((candidate) => sameCandidate(candidate, active)) ?? candidates[0] ?? null
      : candidates[0] ?? null
    setPreviousCandidates(candidates)
    setActive(nextActive)
    setChoices({})
    if (nextActive && (!active || !sameCandidate(nextActive, active))) setMessage('')
  }

  if (!active) {
    return <p role='status' className='mt-6 text-sm text-stone-500'>{message || 'Không tìm thấy cặp hồ sơ nghi trùng trong trang này.'}</p>
  }

  const conflicts = getDuplicateConflicts(active.primary, active.duplicate)
  const relationshipPreviews = active.duplicate.relationship_previews ?? []
  const citationPreviews = active.duplicate.citation_previews ?? []

  function selectCandidate(candidate: DuplicateCandidate) {
    setActive(candidate)
    setChoices({})
    setMessage('')
  }

  function submitMerge() {
    if (!active) return
    if (conflicts.some(({ key }) => !choices[key])) {
      setMessage('Chọn bản ghi giữ lại cho mọi trường có khác biệt trước khi hợp nhất.')
      return
    }
    startTransition(async () => {
      const result = await mergeDuplicatePersons(active.primary.id, active.duplicate.id, choices)
      if (result.error) {
        setMessage(result.error)
        return
      }

      const activeIndex = candidates.findIndex((candidate) => sameCandidate(candidate, active))
      const nextCandidate = candidates[activeIndex + 1] ?? candidates[activeIndex - 1] ?? null
      setActive(nextCandidate)
      setChoices({})
      setMessage(nextCandidate ? 'Đã hợp nhất hồ sơ. Đang chuyển sang cặp tiếp theo.' : 'Đã hợp nhất hồ sơ. Không còn cặp cần rà soát trên trang này.')
      if (nextCandidate) router.refresh()
    })
  }

  return (
    <div className='mt-6 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
      <aside className='rounded-3xl border border-stone-200 bg-white/70 p-4 backdrop-blur-xl'>
        <h2 className='font-serif text-base font-semibold text-primary'>Cặp cần rà soát</h2>
        <div className='mt-3 space-y-2'>
          {candidates.map((candidate) => {
            const isSelected = sameCandidate(active, candidate)
            return (
              <button
                key={`${candidate.primary.id}-${candidate.duplicate.id}`}
                type='button'
                onClick={() => selectCandidate(candidate)}
                className={`w-full rounded-xl p-3 text-left text-sm ${isSelected ? 'bg-stone-100 text-primary' : 'text-stone-600 hover:bg-stone-50'}`}
              >
                <span className='block font-medium'>{candidate.primary.full_name}</span>
                <span className='mt-1 block text-stone-500'>{candidate.score.score}/100 · {candidate.duplicate.full_name}</span>
              </button>
            )
          })}
        </div>
      </aside>

      <section aria-labelledby='review-heading' className='rounded-3xl border border-stone-200 bg-white/70 p-5 backdrop-blur-xl sm:p-6'>
        <div className='flex items-start gap-3'>
          <AlertTriangle className='mt-0.5 size-5 shrink-0 text-amber-700' aria-hidden='true' />
          <div>
            <h2 id='review-heading' className='font-serif text-xl font-semibold text-primary'>Chọn dữ liệu giữ lại</h2>
            <p className='mt-1 text-sm text-stone-500'>Hệ thống không tự động hợp nhất. Điểm nghi trùng: {active.score.score}/100.</p>
          </div>
        </div>

        <ul className='mt-4 flex flex-wrap gap-2' aria-label='Dấu hiệu trùng khớp'>
          {active.score.reasons.map((reason) => (
            <li key={reason.signal} className='rounded-full bg-amber-100 px-3 py-1 text-sm text-stone-700'>
              {reason.label} (+{reason.points})
            </li>
          ))}
        </ul>

        <div className='mt-6 overflow-x-auto'>
          <table className='w-full min-w-[40rem] text-left text-sm'>
            <thead className='border-b border-stone-200 text-stone-500'>
              <tr>
                <th className='pb-3 font-medium'>Trường</th>
                <th className='pb-3 font-medium'>Hồ sơ chính</th>
                <th className='pb-3 font-medium'>Hồ sơ trùng</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(({ key, label }) => (
                <tr key={String(key)} className='border-b border-stone-100 align-top'>
                  <th className='py-3 font-medium text-stone-700'>{label}</th>
                  <td className='py-3'>
                    <label className='flex gap-2'>
                      <input
                        type='radio'
                        name={String(key)}
                        checked={choices[key] === 'primary'}
                        onChange={() => setChoices((prev) => ({ ...prev, [key]: 'primary' }))}
                      />
                      <span>{valueOf(active.primary, key)}</span>
                    </label>
                  </td>
                  <td className='py-3'>
                    <label className='flex gap-2'>
                      <input
                        type='radio'
                        name={String(key)}
                        checked={choices[key] === 'duplicate'}
                        onChange={() => setChoices((prev) => ({ ...prev, [key]: 'duplicate' }))}
                      />
                      <span>{valueOf(active.duplicate, key)}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className='mt-6 rounded-2xl bg-stone-50 p-4 text-sm text-stone-600'>
          <div className='flex gap-2'>
            <Users className='size-4 shrink-0' aria-hidden='true' />
            <p>Quan hệ, nguồn tư liệu, chi tiết riêng tư, sự kiện và metadata thư viện gắn với hồ sơ trùng sẽ chuyển sang hồ sơ chính. Quan hệ trùng hoặc tự tham chiếu bị bỏ qua.</p>
          </div>
        </div>

        <div className='mt-4 grid gap-4 lg:grid-cols-2'>
          <section aria-labelledby='relationship-preview-heading' className='rounded-2xl bg-stone-50 p-4 text-sm text-stone-600'>
            <h3 id='relationship-preview-heading' className='font-medium text-stone-700'>Quan hệ sẽ chuyển ({relationshipPreviews.length})</h3>
            {relationshipPreviews.length ? (
              <ul className='mt-2 space-y-1'>
                {relationshipPreviews.map((relationship) => (
                  <li key={relationship.id}>{relationshipLabel(relationship.type, relationship.direction)}: {relationship.related_person_name}</li>
                ))}
              </ul>
            ) : <p className='mt-2'>Không có quan hệ cần chuyển.</p>}
          </section>

          <section aria-labelledby='citation-preview-heading' className='rounded-2xl bg-stone-50 p-4 text-sm text-stone-600'>
            <h3 id='citation-preview-heading' className='font-medium text-stone-700'>Trích dẫn sẽ chuyển ({citationPreviews.length})</h3>
            {citationPreviews.length ? (
              <ul className='mt-2 space-y-1'>
                {citationPreviews.map((citation) => (
                  <li key={citation.id}>{citation.source_title}{citation.field_name ? ` · ${citation.field_name}` : ''}{citation.page_reference ? ` · tr. ${citation.page_reference}` : ''}{citation.quotation ? `: ${citation.quotation}` : ''}</li>
                ))}
              </ul>
            ) : <p className='mt-2'>Không có trích dẫn cần chuyển.</p>}
          </section>
        </div>

        {message && <p role='status' className='mt-4 text-sm text-stone-600'>{message}</p>}

        <button
          type='button'
          onClick={submitMerge}
          disabled={pending}
          className='btn-primary mt-6 disabled:cursor-not-allowed disabled:opacity-60'
        >
          <GitMerge className='size-4' aria-hidden='true' />
          {pending ? 'Đang hợp nhất...' : 'Xác nhận hợp nhất'}
        </button>
      </section>
    </div>
  )
}
