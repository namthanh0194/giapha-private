'use client'

import {
  createChildrenAction,
  createRelationshipAction,
  createSpouseAction,
  deleteRelationshipAction,
  updateMemberAction
} from '@/app/actions/member'
import {
  MemberListContext,
  useMemberListView
} from '@/context/MemberListContext'
import { Person, RelationshipType } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import { getAvatarBg } from '@/utils/styleHelprs'
import { createClient } from '@/utils/supabase/client'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useContext, useEffect, useState } from 'react'
import DefaultAvatar from './DefaultAvatar'

interface RelationshipManagerProps {
  person: Person
  isAdmin: boolean
  canEdit?: boolean
  onStatsLoaded?: (stats: {
    biologicalChildren: number
    maleBiologicalChildren: number
    femaleBiologicalChildren: number
    paternalGrandchildren: number
    maternalGrandchildren: number
    sonInLaw: number
    daughterInLaw: number
  }) => void
}

interface EnrichedRelationship {
  id: string
  version: number
  type: RelationshipType
  direction: 'parent' | 'child' | 'spouse' | 'child_in_law'
  targetPerson: Person
  note: string | null
}

export default function RelationshipManager({
  person,
  isAdmin,
  canEdit = false,
  onStatsLoaded
}: RelationshipManagerProps) {
  const supabase = createClient()
  const memberListContext = useContext(MemberListContext)
  const { setMemberModalId } = useMemberListView()
  const router = useRouter()

  const personId = person.id
  const personGender = person.gender

  // If inside DashboardProvider → open modal; otherwise → navigate to full page
  const handlePersonClick = (id: string) => {
    if (memberListContext !== undefined) {
      setMemberModalId(id)
    } else {
      router.push(`/dashboard/members/${id}`)
    }
  }

  const [relationships, setRelationships] = useState<EnrichedRelationship[]>([])
  const [loading, setLoading] = useState(true)

  // Add Relationship State
  const [isAdding, setIsAdding] = useState(false)
  const [newRelType, setNewRelType] =
    useState<RelationshipType>('biological_child')
  const [newRelDirection, setNewRelDirection] = useState<
    'parent' | 'child' | 'spouse'
  >('parent')
  const [newRelNote, setNewRelNote] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Person[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bulk Add State
  const [isAddingBulk, setIsAddingBulk] = useState(false)
  const [selectedSpouseId, setSelectedSpouseId] = useState<string>('')
  const [bulkChildren, setBulkChildren] = useState<
    {
      name: string
      gender: 'male' | 'female' | 'other'
      birthYear: string
      birthOrder: string
      isProcessing: boolean
    }[]
  >([
    {
      name: '',
      gender: 'male',
      birthYear: '',
      birthOrder: '1',
      isProcessing: false
    }
  ])

  // Quick Add Spouse State
  const [isAddingSpouse, setIsAddingSpouse] = useState(false)
  const [newSpouseName, setNewSpouseName] = useState('')
  const [newSpouseBirthYear, setNewSpouseBirthYear] = useState('')
  const [newSpouseNote, setNewSpouseNote] = useState('')

  // Fetch relationships
  const fetchRelationships = useCallback(async () => {
    try {
      // Get all relationships where this person involved
      // This is a bit complex because we need to check both a and b columns
      const { data: relsA, error: errA } = await supabase
        .from('relationships')
        .select(`*, target:persons!person_b(*)`) // if I am A, target is B
        .eq('person_a', personId)

      const { data: relsB, error: errB } = await supabase
        .from('relationships')
        .select(`*, target:persons!person_a(*)`) // if I am B, target is A
        .eq('person_b', personId)

      if (errA || errB) throw errA || errB

      const formattedRels: EnrichedRelationship[] = []

      // Process Rels where I am Person A
      relsA?.forEach((r) => {
        let direction: 'parent' | 'child' | 'spouse' = 'spouse'
        if (r.type === 'marriage') direction = 'spouse'
        else if (r.type === 'biological_child' || r.type === 'adopted_child')
          direction = 'child' // I am A (Parent), B is Child

        formattedRels.push({
          id: r.id,
          version: r.version ?? 1,
          type: r.type,
          direction,
          targetPerson: r.target,
          note: r.note
        })
      })

      // Process Rels where I am Person B
      relsB?.forEach((r) => {
        let direction: 'parent' | 'child' | 'spouse' = 'spouse'
        if (r.type === 'marriage') direction = 'spouse'
        else if (r.type === 'biological_child' || r.type === 'adopted_child')
          direction = 'parent' // I am B (Child), A is Parent

        formattedRels.push({
          id: r.id,
          version: r.version ?? 1,
          type: r.type,
          direction,
          targetPerson: r.target,
          note: r.note
        })
      })

      // Fetch in-laws (spouses of children)
      const childrenIds = formattedRels
        .filter((r) => r.direction === 'child')
        .map((r) => r.targetPerson.id)

      if (childrenIds.length > 0) {
        const { data: childrenMarriages } = await supabase
          .from('relationships')
          .select(
            `*, person_a_data:persons!person_a(*), person_b_data:persons!person_b(*)`
          )
          .eq('type', 'marriage')
          .or(
            `person_a.in.(${childrenIds.join(',')}),person_b.in.(${childrenIds.join(',')})`
          )

        if (childrenMarriages) {
          childrenMarriages.forEach((m) => {
            const isAChild = childrenIds.includes(m.person_a)
            const childPerson = isAChild ? m.person_a_data : m.person_b_data
            const spousePerson = isAChild ? m.person_b_data : m.person_a_data

            if (spousePerson && childPerson) {
              const spouseGender = spousePerson.gender
              let noteLabel = `Vợ/chồng của ${childPerson.full_name}`
              if (spouseGender === 'female')
                noteLabel = `Con dâu (vợ của ${childPerson.full_name})`
              if (spouseGender === 'male')
                noteLabel = `Con rể (chồng của ${childPerson.full_name})`

              // Append existing marriage note if any
              if (m.note) noteLabel += ` - ${m.note}`

              formattedRels.push({
                id: m.id + '_inlaw',
                version: m.version ?? 1,
                type: 'marriage',
                direction: 'child_in_law',
                targetPerson: spousePerson,
                note: noteLabel
              })
            }
          })
        }
      }

      if (onStatsLoaded) {
        const biologicalChildrenList = formattedRels.filter(
          (r) => r.direction === 'child' && r.type === 'biological_child'
        )
        const biologicalChildren = biologicalChildrenList.length
        const maleBiologicalChildren = biologicalChildrenList.filter(
          (c) => c.targetPerson.gender === 'male'
        ).length
        const femaleBiologicalChildren = biologicalChildrenList.filter(
          (c) => c.targetPerson.gender === 'female'
        ).length

        const daughterInLaw = formattedRels.filter(
          (r) =>
            r.direction === 'child_in_law' && r.targetPerson.gender === 'female'
        ).length
        const sonInLaw = formattedRels.filter(
          (r) =>
            r.direction === 'child_in_law' && r.targetPerson.gender === 'male'
        ).length

        // Fetch Grandchildren mapping
        let paternalGrandchildren = 0
        let maternalGrandchildren = 0
        if (childrenIds.length > 0) {
          const { data: grandchildrenData } = await supabase
            .from('relationships')
            .select('id, person_a')
            .in('type', ['biological_child', 'adopted_child'])
            .in('person_a', childrenIds)

          if (grandchildrenData) {
            const maleChildrenIds = formattedRels
              .filter(
                (r) =>
                  r.direction === 'child' && r.targetPerson.gender === 'male'
              )
              .map((r) => r.targetPerson.id)
            const femaleChildrenIds = formattedRels
              .filter(
                (r) =>
                  r.direction === 'child' && r.targetPerson.gender === 'female'
              )
              .map((r) => r.targetPerson.id)

            paternalGrandchildren = grandchildrenData.filter((g) =>
              maleChildrenIds.includes(g.person_a)
            ).length
            maternalGrandchildren = grandchildrenData.filter((g) =>
              femaleChildrenIds.includes(g.person_a)
            ).length
          }
        }

        onStatsLoaded({
          biologicalChildren,
          maleBiologicalChildren,
          femaleBiologicalChildren,
          paternalGrandchildren,
          maternalGrandchildren,
          sonInLaw,
          daughterInLaw
        })
      }

      setRelationships(formattedRels)
    } catch (err) {
      console.error('Error fetching relationships:', err)
    } finally {
      setLoading(false)
    }
  }, [personId, supabase, onStatsLoaded])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchRelationships, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchRelationships])

  // Search only with debounced fetch and AbortController
  useEffect(() => {
    if (searchTerm.trim().length < 2) return

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search/persons?q=${encodeURIComponent(searchTerm.trim())}&limit=20`,
          { signal: controller.signal }
        )
        if (!response.ok) return
        const payload = (await response.json()) as { persons: Person[] }
        setSearchResults((payload.persons ?? []).filter((p) => p.id !== personId))
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError') {
          setSearchResults([])
        }
      }
    }, 275)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [searchTerm, personId])
  const handleAddRelationship = async () => {
    if (!selectedTargetId) return
    setProcessing(true)
    setError(null)

    try {
      let personA = personId
      let personB = selectedTargetId
      // Default: I am A, Target is B.

      // Setup payload based on logic
      // Marriage: Order doesn't strictly matter logically, but consistency is good.
      // Parent/Child:
      //    Relationship Type: biological_child
      //    Column A: Parent
      //    Column B: Child

      if (newRelDirection === 'parent') {
        // Target is Parent (A), I am Child (B)
        personA = selectedTargetId
        personB = personId
      } else if (newRelDirection === 'child') {
        // I am Parent (A), Target is Child (B)
        personA = personId
        personB = selectedTargetId
      }

      // Determine Type
      let type: RelationshipType = 'biological_child'
      if (newRelDirection === 'spouse') type = 'marriage'
      else if (newRelType === 'adopted_child') type = 'adopted_child'

      const relationshipResult = await createRelationshipAction(
        personA,
        personB,
        type,
        newRelNote || null
      )
      if (!relationshipResult.success) throw new Error(relationshipResult.error)

      // Auto-update target person generation and is_in_law if currently missing
      try {
        const { data: targetPerson } = await supabase
          .from('persons')
          .select('version, generation, is_in_law')
          .eq('id', selectedTargetId)
          .single()

        if (
          targetPerson &&
          (targetPerson.generation == null || targetPerson.is_in_law == null)
        ) {
          const updates: { generation?: number; is_in_law?: boolean } = {}

          if (targetPerson.generation == null && person.generation != null) {
            if (newRelDirection === 'child')
              updates.generation = person.generation + 1
            else if (newRelDirection === 'parent')
              updates.generation = person.generation - 1
            else if (newRelDirection === 'spouse')
              updates.generation = person.generation
          }

          if (targetPerson.is_in_law == null) {
            if (newRelDirection === 'child' || newRelDirection === 'parent')
              updates.is_in_law = false
            else if (newRelDirection === 'spouse')
              updates.is_in_law = person.is_in_law === true ? false : true
          }

          if (Object.keys(updates).length > 0) {
            const result = await updateMemberAction(
              selectedTargetId,
              targetPerson.version ?? 1,
              updates
            )
            if (!result.success) throw new Error(result.error)
          }
        }
      } catch (err) {
        console.error('Failed to auto-update target person properties', err)
      }

      setIsAdding(false)
      setSearchTerm('')
      setSelectedTargetId(null)
      setNewRelNote('')
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError('Không thể thêm mối quan hệ: ' + e.message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  const handleBulkAdd = async () => {
    // Filter out rows without a name
    const validChildren = bulkChildren.filter((c) => c.name.trim() !== '')
    if (validChildren.length === 0) {
      setError('Vui lòng nhập ít nhất tên của 1 người con.')
      setTimeout(() => setError(null), 5000)
      return
    }

    setProcessing(true)
    setError(null)
    try {
      const parentIds = [personId]
      if (selectedSpouseId && selectedSpouseId !== 'unknown') {
        parentIds.push(selectedSpouseId)
      }
      const children = validChildren.map((child) => ({
        full_name: child.name.trim(),
        gender: child.gender,
        birth_year: child.birthYear.trim()
          ? Number.parseInt(child.birthYear, 10)
          : null,
        birth_order: child.birthOrder.trim()
          ? Number.parseInt(child.birthOrder, 10)
          : null,
        generation:
          person.generation != null ? person.generation + 1 : null
      }))
      const result = await createChildrenAction(parentIds, children)
      if ('error' in result) throw new Error(result.error)

      setIsAddingBulk(false)
      setBulkChildren([
        {
          name: '',
          gender: 'male',
          birthYear: '',
          birthOrder: '1',
          isProcessing: false
        }
      ])
      setSelectedSpouseId('')
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError('Không thể thêm danh sách con: ' + e.message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  const handleQuickAddSpouse = async () => {
    if (!newSpouseName.trim()) {
      setError('Vui lòng nhập tên Vợ/Chồng.')
      setTimeout(() => setError(null), 5000)
      return
    }

    setProcessing(true)
    setError(null)
    try {
      // Determine default gender based on current person defined in personGender prop
      // Default to opposite. If original is other, default to female (arbitrary choice, or let user pick, but standard says opposite)
      const newSpouseGender =
        personGender === 'male'
          ? 'female'
          : personGender === 'female'
            ? 'male'
            : 'female'

      const personPayload: {
        full_name: string
        gender: 'male' | 'female' | 'other'
        birth_year?: number
        is_in_law?: boolean
        generation?: number
      } = {
        full_name: newSpouseName.trim(),
        gender: newSpouseGender,
        is_in_law: person.is_in_law === true ? false : true
      }

      if (person.generation != null) {
        personPayload.generation = person.generation
      }

      if (newSpouseBirthYear.trim() !== '') {
        const year = parseInt(newSpouseBirthYear)
        if (!isNaN(year)) personPayload.birth_year = year
      }

      const result = await createSpouseAction(
        personId,
        personPayload,
        newSpouseNote.trim() || null
      )
      if ('error' in result) throw new Error(result.error)

      setIsAddingSpouse(false)
      setNewSpouseName('')
      setNewSpouseBirthYear('')
      setNewSpouseNote('')
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError('Không thể thêm vợ/chồng: ' + e.message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (relId: string, expectedVersion: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa mối quan hệ này?')) return
    try {
      const result = await deleteRelationshipAction(relId, expectedVersion)
      if (!result.success) throw new Error(result.error)
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError('Không thể xóa: ' + e.message)
      setTimeout(() => setError(null), 5000)
    }
  }

  const groupByType = (type: string) => {
    const items = relationships.filter((r) => r.direction === type)

    // Nếu là nhóm con cái → sắp xếp theo birth_order
    if (type === 'child') {
      return items.sort((a, b) => {
        const orderA = a.targetPerson.birth_order
        const orderB = b.targetPerson.birth_order

        if (orderA != null && orderB != null) {
          return orderA - orderB
        }

        if (orderA != null) return -1
        if (orderB != null) return 1

        return (
          (a.targetPerson.birth_year ?? 9999) -
          (b.targetPerson.birth_year ?? 9999)
        )
      })
    }

    return items
  }

  if (loading)
    return (
      <div className='text-sm text-stone-500'>
        Đang tải thông tin gia đình...
      </div>
    )

  return (
    <div className='space-y-6'>
      {/* List Sections */}
      {['parent', 'spouse', 'child', 'child_in_law'].map((group) => {
        const items = groupByType(group)
        let title = ''
        if (group === 'parent') title = 'Bố / Mẹ'
        if (group === 'spouse') title = 'Vợ / Chồng'
        if (group === 'child') title = 'Con cái'
        if (group === 'child_in_law') title = 'Con dâu / Con rể'

        if (items.length === 0 && !isAdmin) return null // Hide empty sections for members? Or show empty state?

        return (
          <div
            key={group}
            className='border-b border-stone-100 pb-4 last:border-0'>
            <h4 className='mb-3 flex items-center justify-between text-base font-semibold text-stone-700'>
              {title}
            </h4>
            {items.length > 0 ? (
              <ul className='space-y-3'>
                {items.map((rel) => (
                  <li
                    key={rel.id}
                    className='group flex items-center justify-between'>
                    <button
                      onClick={() => handlePersonClick(rel.targetPerson.id)}
                      className='-mx-2.5 flex flex-1 items-center gap-3 rounded-xl p-2.5 text-left transition-all duration-200 hover:bg-stone-100'>
                      <div
                        className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm text-white ${getAvatarBg(rel.targetPerson.gender)}`}>
                        {getAvatarUrl(rel.targetPerson.avatar_url) ? (
                          <Image
                            unoptimized
                            src={getAvatarUrl(rel.targetPerson.avatar_url)!}
                            alt={rel.targetPerson.full_name}
                            className='h-full w-full object-cover'
                            width={32}
                            height={32}
                          />
                        ) : (
                          <DefaultAvatar
                            gender={rel.targetPerson.gender}
                            size={32}
                          />
                        )}
                      </div>
                      <div className='flex flex-col'>
                        <span className='text-sm font-medium text-stone-900'>
                          {rel.targetPerson.full_name}
                        </span>
                        {rel.note && (
                          <span className='mt-0.5 text-sm font-medium text-amber-600 italic'>
                            ({rel.note})
                          </span>
                        )}
                        {rel.type === 'adopted_child' && (
                          <span className='mt-0.5 text-sm text-stone-400 italic'>
                            (Con nuôi)
                          </span>
                        )}
                      </div>
                    </button>
                    {canEdit && rel.direction !== 'child_in_law' && (
                      <button
                        onClick={() => handleDelete(rel.id, rel.version)}
                        className='ml-2 flex items-center justify-center rounded-lg p-2 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 sm:p-2.5'
                        title='Xóa mối quan hệ'
                        aria-label='Xóa mối quan hệ'>
                        <svg
                          xmlns='http://www.w3.org/2000/svg'
                          width='16'
                          height='16'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'>
                          <path d='M3 6h18' />
                          <path d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' />
                          <path d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' />
                          <line x1='10' x2='10' y1='11' y2='17' />
                          <line x1='14' x2='14' y1='11' y2='17' />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-sm text-stone-400 italic'>
                Chưa có thông tin.
              </p>
            )}
          </div>
        )
      })}

      {/* Add Button (Admin) */}
      {canEdit && !isAdding && !isAddingBulk && !isAddingSpouse && (
        <div className='mt-4 flex flex-col gap-3 sm:flex-row'>
          <button
            onClick={() => setIsAdding(true)}
            className='flex-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 py-3 text-sm font-medium text-stone-500 transition-all duration-200 hover:border-amber-400 hover:bg-stone-50 hover:text-amber-700 sm:rounded-2xl'>
            + Thêm Quan Hệ
          </button>

          <button
            onClick={() => setIsAddingBulk(true)}
            className='flex-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 py-3 text-sm font-medium text-stone-500 transition-all duration-200 hover:border-sky-400 hover:bg-stone-50 hover:text-sky-700 sm:rounded-2xl'>
            + Thêm Con
          </button>

          <button
            onClick={() => setIsAddingSpouse(true)}
            className='flex-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 py-3 text-sm font-medium text-stone-500 transition-all duration-200 hover:border-rose-400 hover:bg-stone-50 hover:text-rose-700 sm:rounded-2xl'>
            + Thêm Vợ/Chồng
          </button>
        </div>
      )}

      {error && !isAdding && !isAddingBulk && !isAddingSpouse && (
        <div className='animate-in fade-in slide-in-from-top-2 mt-4 flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-600'>
          <div className='flex items-center gap-2'>
            <svg
              className='h-5 w-5 shrink-0 text-red-500'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
              />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className='p-1 text-red-400 transition-colors hover:text-red-600'>
            <svg
              className='h-4 w-4'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>
      )}

      {/* Add Form (Admin) */}
      {canEdit && isAdding && (
        <div className='mt-4 rounded-xl border border-stone-200 bg-stone-50/50 p-4 sm:p-5'>
          <h4 className='mb-3 text-base font-semibold text-stone-800'>
            Thêm quan hệ mới
          </h4>

          <div className='space-y-3'>
            <div>
              <label
                htmlFor='rel-note'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Ghi chú mối quan hệ (tuỳ chọn)
              </label>
              <input
                id='rel-note'
                name='rel-note'
                type='text'
                placeholder='VD: Vợ cả, Vợ hai, Chồng trước...'
                value={newRelNote}
                onChange={(e) => setNewRelNote(e.target.value)}
                className='mb-3 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'
              />
            </div>

            <div>
              <label
                htmlFor='rel-direction'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Loại quan hệ
              </label>
              <select
                id='rel-direction'
                name='rel-direction'
                value={newRelDirection}
                onChange={(e) =>
                  setNewRelDirection(
                    e.target.value as 'parent' | 'child' | 'spouse'
                  )
                }
                className='block w-full max-w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'>
                <option value='parent'>Người này là Con của...</option>
                <option value='spouse'>Người này là Vợ/Chồng của...</option>
                <option value='child'>Người này là Bố/Mẹ của...</option>
              </select>
            </div>

            {/* Child Type Sub-selection */}
            {(newRelDirection === 'child' || newRelDirection === 'parent') && (
              <div>
                <label
                  htmlFor='rel-type'
                  className='mb-1 block text-sm font-medium text-stone-600'>
                  Chi tiết
                </label>
                <select
                  id='rel-type'
                  name='rel-type'
                  value={newRelType}
                  onChange={(e) =>
                    setNewRelType(e.target.value as RelationshipType)
                  }
                  className='block w-full max-w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'>
                  <option value='biological_child'>Con ruột</option>
                  <option value='adopted_child'>Con nuôi</option>
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor='rel-search'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Tìm người thân
              </label>
              <input
                id='rel-search'
                name='rel-search'
                type='text'
                placeholder='Nhập tên để tìm...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'
              />
              {/* Search Results Dropdown */}
              {searchTerm.trim().length >= 2 && searchResults.length > 0 && (
                <div className='mt-2 max-h-62.5 overflow-y-auto rounded-md border border-stone-200 bg-white'>
                  <div className='sticky top-0 z-10 border-b border-stone-200 bg-stone-100 px-3 py-1.5 text-sm font-medium text-stone-500'>
                    Kết quả tìm kiếm
                  </div>
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedTargetId(p.id)
                        setSearchTerm(p.full_name)
                        setSearchResults([])
                      }}
                      className='flex items-center justify-between border-b border-stone-100 px-3 py-2 text-sm last:border-0 hover:bg-amber-50'>
                      <div className='flex items-center gap-2'>
                        <span
                          className='flex size-3 shrink-0 items-center justify-center rounded-full bg-stone-500 text-sm font-medium text-white'>
                          {p.gender === 'male'
                            ? '♂'
                            : p.gender === 'female'
                              ? '♀'
                              : '•'}
                        </span>
                        <span className='font-medium text-stone-800'>
                          {p.full_name}
                        </span>
                        {p.birth_year && (
                          <span className='text-sm text-stone-400'>
                            ({p.birth_year})
                          </span>
                        )}
                      </div>
                      <span className='text-sm font-medium text-amber-600'>
                        Chọn
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {selectedTargetId && (
                <p className='mt-1 text-sm text-green-600'>
                  Đã chọn: {searchTerm}
                </p>
              )}
            </div>

            <div className='flex gap-2 pt-2'>
              <button
                onClick={handleAddRelationship}
                disabled={!selectedTargetId || processing}
                className='flex-1 rounded-md bg-amber-700 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-800 disabled:opacity-50 sm:rounded-lg sm:py-2.5'>
                {processing ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button
                onClick={() => {
                  setIsAdding(false)
                  setSelectedTargetId(null)
                  setSearchTerm('')
                  setNewRelNote('')
                }}
                className='rounded-md border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 sm:rounded-lg sm:py-2.5'>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add Children Form (Admin) */}
      {canEdit && isAddingBulk && (
        <div className='mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-4 sm:p-5'>
          <h4 className='mb-3 text-base font-semibold text-sky-800'>
            Thêm nhanh nhiều con
          </h4>

          <div className='space-y-4'>
            <div>
              <label
                htmlFor='bulk-spouse'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Chọn người mẹ/cha còn lại
              </label>
              <select
                id='bulk-spouse'
                name='bulk-spouse'
                value={selectedSpouseId}
                onChange={(e) => setSelectedSpouseId(e.target.value)}
                className='block w-full max-w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:p-2.5'>
                <option value='unknown'>
                  Không rõ (hoặc Vợ/Chồng khác chưa thêm)
                </option>
                {groupByType('spouse').map((rel) => (
                  <option key={rel.id} value={rel.targetPerson.id}>
                    {rel.targetPerson.full_name}{' '}
                    {rel.note ? `(${rel.note})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-3'>
              <label className='mb-1 block text-sm font-medium text-stone-600'>
                Danh sách các con
              </label>
              {bulkChildren.map((child, index) => (
                <div
                  key={index}
                  className='rounded-xl border border-stone-200/80 bg-white p-3 sm:p-4'>
                  {/* Header: number + remove */}
                  <div className='mb-2.5 flex items-center justify-between'>
                    <span className='rounded-md bg-sky-50 px-2 py-0.5 text-sm font-medium text-sky-600'>
                      Con thứ {index + 1}
                    </span>
                    <button
                      onClick={() => {
                        const newBulk = bulkChildren.filter(
                          (_, i) => i !== index
                        )
                        if (newBulk.length === 0) {
                          newBulk.push({
                            name: '',
                            gender: 'male',
                            birthYear: '',
                            birthOrder: '1',
                            isProcessing: false
                          })
                        }
                        setBulkChildren(newBulk)
                      }}
                      className='rounded-lg p-1.5 text-sm text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500'
                      title='Xoá'>
                      ✕
                    </button>
                  </div>
                  {/* Fields */}
                  <div className='flex flex-wrap gap-2 sm:flex-nowrap'>
                    <input
                      id={`child-birth-order-${index}`}
                      name={`child-birth-order-${index}`}
                      type='number'
                      placeholder='STT'
                      min='1'
                      value={child.birthOrder}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].birthOrder = e.target.value
                        setBulkChildren(newBulk)
                      }}
                      className='w-14 shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-1 py-2 text-center text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-sky-500 focus:ring-sky-500'
                    />
                    <input
                      id={`child-name-${index}`}
                      name={`child-name-${index}`}
                      type='text'
                      placeholder='Họ và tên *'
                      value={child.name}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].name = e.target.value
                        setBulkChildren(newBulk)
                      }}
                      className='w-[calc(100%-4rem)] min-w-0 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:w-auto sm:flex-1'
                    />
                    <select
                      id={`child-gender-${index}`}
                      name={`child-gender-${index}`}
                      value={child.gender}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].gender = e.target.value as
                          'male' | 'female' | 'other'
                        setBulkChildren(newBulk)
                      }}
                      className='w-[calc(50%-0.25rem)] shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-2 py-2 text-sm text-stone-900 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:w-24'>
                      <option value='male'>Nam</option>
                      <option value='female'>Nữ</option>
                      <option value='other'>Khác</option>
                    </select>
                    <input
                      id={`child-birth-year-${index}`}
                      name={`child-birth-year-${index}`}
                      type='number'
                      placeholder='Năm sinh'
                      value={child.birthYear}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].birthYear = e.target.value
                        setBulkChildren(newBulk)
                      }}
                      className='w-[calc(50%-0.25rem)] shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-2 py-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:w-24'
                    />
                  </div>
                </div>
              ))}

              <button
                onClick={() => {
                  const nextOrder = String(bulkChildren.length + 1)
                  setBulkChildren([
                    ...bulkChildren,
                    {
                      name: '',
                      gender: 'male',
                      birthYear: '',
                      birthOrder: nextOrder,
                      isProcessing: false
                    }
                  ])
                }}
                className='w-full rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/50 py-2.5 text-sm font-medium text-sky-600 transition-all hover:border-sky-300 hover:bg-sky-50'>
                + Thêm dòng
              </button>
            </div>

            <div className='flex gap-2 border-t border-stone-200 pt-4'>
              <button
                onClick={handleBulkAdd}
                disabled={
                  processing || bulkChildren.every((c) => c.name.trim() === '')
                }
                className='flex-1 rounded-md bg-sky-600 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50 sm:rounded-lg sm:py-2.5'>
                {processing ? 'Đang lưu...' : 'Lưu Tất Cả'}
              </button>
              <button
                onClick={() => {
                  setIsAddingBulk(false)
                  setBulkChildren([
                    {
                      name: '',
                      gender: 'male',
                      birthYear: '',
                      birthOrder: '1',
                      isProcessing: false
                    }
                  ])
                  setSelectedSpouseId('')
                }}
                className='rounded-md border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 sm:rounded-lg sm:py-2.5'>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Spouse Form (Admin) */}
      {canEdit && isAddingSpouse && (
        <div className='mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 sm:p-5'>
          <h4 className='mb-3 text-base font-semibold text-rose-800'>
            Thêm nhanh vợ/chồng
          </h4>

          <div className='space-y-3'>
            <div>
              <label
                htmlFor='spouse-name'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Họ và Tên <span className='text-red-500'>*</span>
              </label>
              <input
                id='spouse-name'
                name='spouse-name'
                type='text'
                placeholder='Nhập họ và tên...'
                value={newSpouseName}
                onChange={(e) => setNewSpouseName(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-rose-500 focus:ring-rose-500 sm:p-2.5'
              />
            </div>

            <div>
              <label
                htmlFor='spouse-birth-year'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Năm sinh (Tuỳ chọn)
              </label>
              <input
                id='spouse-birth-year'
                name='spouse-birth-year'
                type='number'
                placeholder='VD: 1980'
                value={newSpouseBirthYear}
                onChange={(e) => setNewSpouseBirthYear(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-rose-500 focus:ring-rose-500 sm:p-2.5'
              />
            </div>

            <div>
              <label
                htmlFor='spouse-note'
                className='mb-1 block text-sm font-medium text-stone-600'>
                Ghi chú mối quan hệ (Ví dụ: Vợ cả, Chồng thứ...)
              </label>
              <input
                id='spouse-note'
                name='spouse-note'
                type='text'
                placeholder='Tuỳ chọn...'
                value={newSpouseNote}
                onChange={(e) => setNewSpouseNote(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-rose-500 focus:ring-rose-500 sm:p-2.5'
              />
            </div>

            <p className='mt-1 text-sm text-stone-500 italic'>
              * Giới tính sẽ tự động gán là{' '}
              {personGender === 'male'
                ? 'Nữ'
                : personGender === 'female'
                  ? 'Nam'
                  : 'Nữ'}{' '}
              (dựa theo giới tính người hiện tại).
            </p>

            <div className='flex gap-2 pt-2'>
              <button
                onClick={handleQuickAddSpouse}
                disabled={!newSpouseName.trim() || processing}
                className='flex-1 rounded-md bg-rose-600 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50 sm:rounded-lg sm:py-2.5'>
                {processing ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button
                onClick={() => {
                  setIsAddingSpouse(false)
                  setNewSpouseName('')
                  setNewSpouseBirthYear('')
                  setNewSpouseNote('')
                }}
                className='rounded-md border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 sm:rounded-lg sm:py-2.5'>
                Hủy
              </button>
            </div>
            {error && (
              <div className='animate-in fade-in slide-in-from-top-1 mt-2 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600'>
                <svg
                  className='h-4 w-4 shrink-0'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
