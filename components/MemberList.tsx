'use client'

import PersonCard from '@/components/PersonCard'
import { Person, Relationship } from '@/types'
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Search
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { useMemberListView } from '@/context/MemberListContext'

export default function MemberList({
  initialPersons,
  relationships = [],
  canEdit = false,
  pagination
}: {
  initialPersons: Person[]
  relationships?: Relationship[]
  canEdit?: boolean
  pagination?: {
    page: number
    pageSize: number
    total: number
    query: string
    filter: string
    sort: string
  }
}) {
  const { setShowCreateMember } = useMemberListView()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [searchTerm, setSearchTerm] = useState(
    () => pagination?.query ?? searchParams.get('query') ?? ''
  )
  const [sortOption, setSortOption] = useState(
    () => pagination?.sort ?? searchParams.get('sort') ?? 'generation_asc'
  )
  const [filterOption, setFilterOption] = useState(
    () => pagination?.filter ?? searchParams.get('filter') ?? 'all'
  )

  const currentPage = pagination?.page ?? 1
  const pageSize = pagination?.pageSize ?? 50
  const totalCount = pagination?.total ?? initialPersons.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const updateParams = (updates: {
    query?: string
    sort?: string
    filter?: string
    page?: number
  }) => {
    const next = new URLSearchParams(searchParams.toString())

    const nextQuery =
      updates.query !== undefined
        ? updates.query.trim().slice(0, 100)
        : searchTerm.trim().slice(0, 100)
    const nextFilter =
      updates.filter !== undefined ? updates.filter : filterOption
    const nextSort = updates.sort !== undefined ? updates.sort : sortOption
    const nextPage = updates.page !== undefined ? updates.page : 1

    if (nextQuery) next.set('query', nextQuery)
    else next.delete('query')

    if (nextFilter && nextFilter !== 'all') next.set('filter', nextFilter)
    else next.delete('filter')

    if (nextSort && nextSort !== 'generation_asc') next.set('sort', nextSort)
    else next.delete('sort')

    if (nextPage > 1) next.set('page', String(nextPage))
    else next.delete('page')

    next.set('view', 'list')

    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`)
    })
  }

  const filteredPersons = useMemo(() => {
    return initialPersons.filter((person) => {
      const matchesSearch = person.full_name
        .toLowerCase()
        .includes(searchTerm.toLowerCase())

      let matchesFilter = true
      switch (filterOption) {
        case 'male':
          matchesFilter = person.gender === 'male'
          break
        case 'female':
          matchesFilter = person.gender === 'female'
          break
        case 'in_law_female':
          matchesFilter = person.gender === 'female' && person.is_in_law
          break
        case 'in_law_male':
          matchesFilter = person.gender === 'male' && person.is_in_law
          break
        case 'deceased':
          matchesFilter = person.is_deceased
          break
        case 'first_child':
          matchesFilter = person.birth_order === 1
          break
        case 'all':
        default:
          matchesFilter = true
          break
      }

      return matchesSearch && matchesFilter
    })
  }, [initialPersons, searchTerm, filterOption])

  const { parentsOf, spousesOf } = useMemo(() => {
    const pOf = new Map<string, string[]>()
    const sOf = new Map<string, string[]>()

    relationships?.forEach((rel) => {
      if (rel.type === 'biological_child' || rel.type === 'adopted_child') {
        const parentId = rel.person_a
        const childId = rel.person_b
        if (!pOf.has(childId)) pOf.set(childId, [])
        pOf.get(childId)!.push(parentId)
      } else if (rel.type === 'marriage') {
        const p1 = rel.person_a
        const p2 = rel.person_b
        if (!sOf.has(p1)) sOf.set(p1, [])
        if (!sOf.has(p2)) sOf.set(p2, [])
        sOf.get(p1)!.push(p2)
        sOf.get(p2)!.push(p1)
      }
    })

    return { parentsOf: pOf, spousesOf: sOf }
  }, [relationships])

  const sortedPersons = useMemo(() => {
    // If not sorting by generation, use simple flat sort
    if (!sortOption.includes('generation')) {
      return [...filteredPersons].sort((a, b) => {
        switch (sortOption) {
          case 'birth_asc':
            return (a.birth_year || 9999) - (b.birth_year || 9999)
          case 'birth_desc':
            return (b.birth_year || 0) - (a.birth_year || 0)
          case 'name_asc':
            return a.full_name.localeCompare(b.full_name, 'vi')
          case 'name_desc':
            return b.full_name.localeCompare(a.full_name, 'vi')
          case 'updated_desc':
            return (
              new Date(b.updated_at || 0).getTime() -
              new Date(a.updated_at || 0).getTime()
            )
          case 'updated_asc':
            return (
              new Date(a.updated_at || 0).getTime() -
              new Date(b.updated_at || 0).getTime()
            )
          default:
            return 0
        }
      })
    }

    // --- Complex Generation Sorting (Grouped by Family) ---
    // 1. Build basic maps
    const personMap = new Map<string, Person>()
    initialPersons.forEach((p) => personMap.set(p.id, p))

    // 2. Determine "Family Groups" within the same generation
    // We group people if they share the same parents, OR if they are spouses
    // A family groupId will be derived from:
    // a) Their parents' IDs (sorted and joined)
    // b) If no parents, their own ID (or their spouse's, whoever is sorted first)
    const getGroupId = (personId: string) => {
      const parents = parentsOf.get(personId) || []
      if (parents.length > 0) {
        // Has parents -> group by parents
        return 'parents_' + [...parents].sort().join('_')
      }

      // No parents -> check spouses and then check if those spouses have parents
      // Use a small BFS to find the whole marriage cluster
      const visited = new Set<string>([personId])
      const queue = [personId]
      const cluster: string[] = []

      while (queue.length > 0) {
        const curr = queue.shift()!
        cluster.push(curr)
        const pts = parentsOf.get(curr)
        if (pts && pts.length > 0) {
          // Found a bloodline member in the marriage cluster!
          return 'parents_' + [...pts].sort().join('_')
        }

        const sps = spousesOf.get(curr) || []
        for (const s of sps) {
          if (!visited.has(s)) {
            visited.add(s)
            queue.push(s)
          }
        }
      }

      // No one in marriage cluster has parents -> group by the cluster's min ID
      return 'spouses_' + [...cluster].sort()[0]
    }

    // 3. Group the filtered persons into their families
    const families = new Map<string, Person[]>()
    filteredPersons.forEach((p) => {
      const groupId = getGroupId(p.id)
      if (!families.has(groupId)) families.set(groupId, [])
      families.get(groupId)!.push(p)
    })

    // 4. Sort families and persons within families
    // To sort families, we need a representative "score" based on the parents' birth order
    // or the primary member's birth order/birth year.
    const getFamilyScore = (groupId: string, members: Person[]) => {
      // Find the "core" member (usually the bloodline, not in-law)
      // Bloodline members usually have parents in the system or are not-in-law
      const coreMember = members.find((m) => !m.is_in_law) || members[0]

      // Score is represented as an array [generation, parentBirthOrder, ownBirthOrder, birthYear]
      // We only care about parentBirthOrder and ownBirthOrder for sorting families.
      const parents = parentsOf.get(coreMember.id) || []
      let parentBirthOrder = 999
      if (parents.length > 0) {
        const p1 = personMap.get(parents[0])
        if (p1) parentBirthOrder = p1.birth_order || 999
      }

      return {
        parentBirthOrder,
        ownBirthOrder: coreMember.birth_order || 999,
        birthYear: coreMember.birth_year || 9999
      }
    }

    const sortedGroups = Array.from(families.entries()).sort((a, b) => {
      const scoreA = getFamilyScore(a[0], a[1])
      const scoreB = getFamilyScore(b[0], b[1])

      if (scoreA.parentBirthOrder !== scoreB.parentBirthOrder) {
        return scoreA.parentBirthOrder - scoreB.parentBirthOrder
      }
      if (scoreA.ownBirthOrder !== scoreB.ownBirthOrder) {
        return scoreA.ownBirthOrder - scoreB.ownBirthOrder
      }
      return scoreA.birthYear - scoreB.birthYear
    })

    // 5. Flatten the grouped and sorted families
    const finalSorted: Array<Person & { _familyId?: string }> = []
    sortedGroups.forEach(([groupId, members]) => {
      // Sort within the family (Siblings by birth order, spouses follow their partner)
      const getBloodlineRef = (p: Person) => {
        if (!p.is_in_law) return p
        const spIds = spousesOf.get(p.id) || []
        const bloodlineSpouse = members.find(
          (m) => spIds.includes(m.id) && !m.is_in_law
        )
        return bloodlineSpouse || p
      }

      members.sort((a, b) => {
        const refA = getBloodlineRef(a)
        const refB = getBloodlineRef(b)

        // Different bloodline partner -> sort by the bloodline partner's order/age
        if (refA.id !== refB.id) {
          if ((refA.birth_order || 999) !== (refB.birth_order || 999)) {
            return (refA.birth_order || 999) - (refB.birth_order || 999)
          }
          return (refA.birth_year || 9999) - (refB.birth_year || 9999)
        }

        // Same bloodline partner (e.g. one is bloodline, other is spouse)
        if (a.is_in_law !== b.is_in_law) {
          return a.is_in_law ? 1 : -1 // Bloodline first
        }

        // Both are spouses or both bloodline? Sort by age
        return (a.birth_year || 9999) - (b.birth_year || 9999)
      })
      finalSorted.push(...members.map((m) => ({ ...m, _familyId: groupId })))
    })

    // 6. Handle master generation_asc / generation_desc
    // `finalSorted` is now sorted ascending by family grouping and within family.
    // However, they might be mixed generations if we didn't strictly group by generation first.
    // Actually, the rendering code groups by generation AFTER this sort.
    // So if the outer sort wants desc, we just reverse the intra-generation logic?
    // Wait, the rendering code `Object.entries(...reduce(...))` groups by `generation`.
    // Then it sorts the generation keys.
    // Inside a single generation bucket, it preserves the array order.
    // So we just need to ensure the array provided to reduce is correctly ordered ascending.
    // If sortOption === 'generation_desc', the rendering sorts keys descending, but should it reverse within the generation?
    // Usually families are still displayed older->younger even if generations are grouped Z-A.
    // We will apply a default ascending flow to `finalSorted`.

    // If generation_desc is strictly needed across the whole list (if not grouped by UI later),
    // we'd sort by generation here. But since UI groups by generation, we just return `finalSorted`.
    // Let's ensure generation is the primary sort key just in case.
    finalSorted.sort((a, b) => {
      const genA = a.generation || 999
      const genB = b.generation || 999
      if (genA !== genB) {
        return sortOption === 'generation_desc' ? genB - genA : genA - genB
      }
      // If same generation, preserve the family sorting we just did
      return 0
    })

    return finalSorted
  }, [filteredPersons, sortOption, initialPersons, parentsOf, spousesOf])

  return (
    <>
      <div className='relative mb-8'>
        <div className='relative z-10 flex w-full flex-col items-start justify-between gap-4 rounded-2xl border border-stone-200/60 bg-white/60 p-4 backdrop-blur-xl transition-all duration-300 sm:flex-row sm:items-center sm:p-5'>
          <div className='flex w-full flex-1 flex-col gap-4 sm:w-auto sm:flex-row'>
            <div className='group relative max-w-sm flex-1'>
              <Search className='absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400 transition-colors group-focus-within:text-amber-500' />
              <input
                type='text'
                placeholder='Tìm kiếm thành viên...'
                className='w-full rounded-xl border border-stone-200/80 bg-white/90 py-2.5 pr-4 pl-10 text-sm text-stone-900 placeholder-stone-400 transition-all focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 focus:outline-none'
                value={searchTerm}
                maxLength={100}
                onChange={(e) => {
                  const val = e.target.value
                  setSearchTerm(val)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateParams({ query: searchTerm, page: 1 })
                  }
                }}
              />
            </div>
            <div className='flex w-full flex-col items-center gap-2 sm:w-auto sm:flex-row sm:gap-3'>
              <div className='relative w-full sm:w-auto'>
                <Filter className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <select
                  className='w-full appearance-none rounded-xl border border-stone-200/80 bg-white/90 py-2.5 pr-8 pl-9 text-sm font-medium text-stone-700 transition-all hover:border-amber-300 focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-500/20 focus:outline-none sm:w-40'
                  value={filterOption}
                  onChange={(e) => {
                    const val = e.target.value
                    setFilterOption(val)
                    updateParams({ filter: val, page: 1 })
                  }}>
                  <option value='all'>Tất cả</option>
                  <option value='male'>Nam</option>
                  <option value='female'>Nữ</option>
                  <option value='in_law_female'>Dâu</option>
                  <option value='in_law_male'>Rể</option>
                  <option value='deceased'>Đã mất</option>
                  <option value='first_child'>Con trưởng</option>
                </select>
                <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center px-2'>
                  <svg
                    className='size-4 text-stone-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M19 9l-7 7-7-7'></path>
                  </svg>
                </div>
              </div>

              <div className='relative w-full sm:w-auto'>
                <ArrowUpDown className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <select
                  className='w-full appearance-none rounded-xl border border-stone-200/80 bg-white/90 py-2.5 pr-8 pl-9 text-sm font-medium text-stone-700 transition-all hover:border-amber-300 focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-500/20 focus:outline-none sm:w-52'
                  value={sortOption}
                  onChange={(e) => {
                    const val = e.target.value
                    setSortOption(val)
                    updateParams({ sort: val, page: 1 })
                  }}>
                  <option value='birth_asc'>Năm sinh (Tăng dần)</option>
                  <option value='birth_desc'>Năm sinh (Giảm dần)</option>
                  <option value='name_asc'>Tên (A-Z)</option>
                  <option value='name_desc'>Tên (Z-A)</option>
                  <option value='updated_desc'>Cập nhật (Mới nhất)</option>
                  <option value='updated_asc'>Cập nhật (Cũ nhất)</option>
                  <option value='generation_asc'>Theo thế hệ (Tăng dần)</option>
                  <option value='generation_desc'>
                    Theo thế hệ (Giảm dần)
                  </option>
                </select>
                <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center px-2'>
                  <svg
                    className='size-4 text-stone-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M19 9l-7 7-7-7'></path>
                  </svg>
                </div>
              </div>
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowCreateMember(true)}
              className='btn-primary'>
              <Plus className='size-4' strokeWidth={2.5} />
              Thêm thành viên
            </button>
          )}
        </div>
      </div>

      {sortedPersons.length > 0 ? (
        sortOption.includes('generation') ? (
          <div className='space-y-12'>
            {Object.entries(
              sortedPersons.reduce(
                (acc, person) => {
                  const gen = person.generation || 0
                  if (!acc[gen]) acc[gen] = []
                  acc[gen].push(person)
                  return acc
                },
                {} as Record<number, Person[]>
              )
            )
              .sort(([genA], [genB]) => {
                if (sortOption === 'generation_desc') {
                  return Number(genB) - Number(genA)
                }
                return Number(genA) - Number(genB)
              })
              .map(([gen, persons]) => {
                const familiesMap = new Map<string, typeof persons>()
                persons.forEach((p) => {
                  const fid =
                    (p as Person & { _familyId?: string })._familyId ||
                    'unknown'
                  if (!familiesMap.has(fid)) familiesMap.set(fid, [])
                  familiesMap.get(fid)!.push(p)
                })

                return (
                  <div key={gen} className='space-y-6'>
                    <div className='flex items-center gap-3'>
                      <div className='h-px flex-1 bg-stone-200'></div>
                      <h3 className='rounded-full border border-amber-200/50 bg-amber-50 px-4 py-1.5 font-serif text-lg font-semibold text-amber-800'>
                        {gen === '0' ? 'Chưa xác định đời' : `Đời thứ ${gen}`}
                      </h3>
                      <div className='h-px flex-1 bg-stone-200'></div>
                    </div>
                    <div className='space-y-12'>
                      {Array.from(familiesMap.values()).map(
                        (famPersons, idx) => (
                          <div
                            key={idx}
                            className='relative rounded-[2.5rem] border border-stone-300 bg-white p-5 sm:p-8'>
                            {(() => {
                              const firstBloodline =
                                famPersons.find((p) => !p.is_in_law) ||
                                famPersons[0]
                              const parentIds =
                                parentsOf.get(firstBloodline.id) || []
                              const parents = parentIds
                                .map((id) =>
                                  initialPersons.find((p) => p.id === id)
                                )
                                .filter(Boolean) as Person[]
                              const parentNames = parents
                                .map((p) =>
                                  p.full_name
                                    .trim()
                                    .split(' ')
                                    .splice(-2)
                                    .join(' ')
                                )
                                .join(' & ')

                              const label = parentNames
                                ? `Con của: ${parentNames}`
                                : familiesMap.size > 1
                                  ? `Gia đình ${idx + 1}`
                                  : null

                              if (!label) return null

                              return (
                                <div className='absolute -top-3 left-8 z-20 rounded-full border border-stone-300 bg-stone-100 px-3 py-0.5 text-sm font-medium text-stone-600'>
                                  {label}
                                </div>
                              )
                            })()}
                            <div
                              className={`grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3`}>
                              {(() => {
                                // Group famPersons into couple groups strictly by spouse relationships
                                const coupleGroups: Person[][] = []
                                const placed = new Set<string>()

                                for (const p of famPersons) {
                                  if (placed.has(p.id)) continue
                                  const group = [p]
                                  placed.add(p.id)

                                  // Find all spouses connected to this person
                                  const queue = [p.id]
                                  while (queue.length > 0) {
                                    const curr = queue.shift()!
                                    const spIds = spousesOf.get(curr) || []
                                    for (const spId of spIds) {
                                      if (!placed.has(spId)) {
                                        const spObj = famPersons.find(
                                          (m) => m.id === spId
                                        )
                                        if (spObj) {
                                          group.push(spObj)
                                          placed.add(spId)
                                          queue.push(spId)
                                        }
                                      }
                                    }
                                  }

                                  // Balanced Sort: Place bloodline members in the center
                                  // This ensures HUB -- SPOUSE links work best in a horizontal grid.
                                  const bloodlineMembers = group
                                    .filter((m) => !m.is_in_law)
                                    .sort(
                                      (a, b) =>
                                        (a.birth_year || 0) -
                                        (b.birth_year || 0)
                                    )
                                  const inLawMembers = group
                                    .filter((m) => m.is_in_law)
                                    .sort(
                                      (a, b) =>
                                        (a.birth_year || 0) -
                                        (b.birth_year || 0)
                                    )

                                  const balanced: Person[] = []
                                  if (group.length <= 2) {
                                    balanced.push(
                                      ...bloodlineMembers,
                                      ...inLawMembers
                                    )
                                  } else {
                                    // For 3+ people, put the main person(s) in the middle
                                    // Example for 3: [InLaw 1, Bloodline, InLaw 2]
                                    let bIdx = 0
                                    let iIdx = 0
                                    const slots = new Array(group.length)

                                    // Put bloodline in center or near center
                                    const mid = Math.floor(group.length / 2)
                                    slots[mid] = bloodlineMembers[bIdx++]

                                    // Distribute others around
                                    let offset = 1
                                    while (
                                      bIdx < bloodlineMembers.length ||
                                      iIdx < inLawMembers.length
                                    ) {
                                      const next =
                                        bIdx < bloodlineMembers.length
                                          ? bloodlineMembers[bIdx++]
                                          : inLawMembers[iIdx++]
                                      if (
                                        mid + offset < group.length &&
                                        !slots[mid + offset]
                                      )
                                        slots[mid + offset] = next
                                      else if (
                                        mid - offset >= 0 &&
                                        !slots[mid - offset]
                                      )
                                        slots[mid - offset] = next
                                      else {
                                        // Find first empty slot
                                        const empty = slots.findIndex((s) => !s)
                                        if (empty !== -1) slots[empty] = next
                                      }
                                      offset++
                                    }
                                    balanced.push(...slots.filter((s) => !!s))
                                  }

                                  coupleGroups.push(balanced)
                                }
                                return coupleGroups.map((group, gIdx) => {
                                  const isCouple = group.length > 1
                                  const colSpanClass =
                                    group.length === 2
                                      ? 'md:col-span-2'
                                      : group.length >= 3
                                        ? 'md:col-span-2 lg:col-span-3'
                                        : 'col-span-1'
                                  const innerGridClass =
                                    group.length === 2
                                      ? 'md:grid-cols-2'
                                      : group.length >= 3
                                        ? 'md:grid-cols-2 lg:grid-cols-3'
                                        : 'grid-cols-1'

                                  return (
                                    <div
                                      key={gIdx}
                                      className={`relative ${colSpanClass}`}>
                                      {isCouple && (
                                        <>
                                          {/* Desktop & Tablet background */}
                                          <div className='absolute -inset-3 z-0 hidden rounded-4xl border border-amber-200/80 bg-amber-50/70 md:block lg:-inset-4'></div>
                                          {/* Mobile background */}
                                          <div className='absolute -inset-2 z-0 rounded-3xl border border-amber-200/80 bg-amber-50/70 md:hidden'></div>
                                        </>
                                      )}
                                      <div
                                        className={`relative z-10 grid grid-cols-1 ${innerGridClass} h-full gap-y-6 md:gap-x-6`}>
                                        {group.map((person, pIdx) => (
                                          <div
                                            key={person.id}
                                            className='relative flex h-full flex-col'>
                                            <PersonCard person={person} />
                                            {/* Visual link between spouses (desktop >= md) */}
                                            {isCouple &&
                                              pIdx < group.length - 1 && (
                                                <div className='absolute top-[50%] -right-3 z-10 hidden h-0.5 w-6 translate-x-1/2 bg-amber-300 md:block'></div>
                                              )}
                                            {/* Visual link between spouses (mobile < md) */}
                                            {isCouple &&
                                              pIdx < group.length - 1 && (
                                                <div className='absolute -bottom-6 left-1/2 z-10 h-6 w-0.5 -translate-x-1/2 bg-amber-300 md:hidden'></div>
                                              )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })
                              })()}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
            {sortedPersons.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        )
      ) : (
        <div className='py-12 text-center text-stone-400 italic'>
          {initialPersons.length > 0
            ? 'Không tìm thấy thành viên phù hợp.'
            : 'Chưa có thành viên nào. Hãy thêm thành viên đầu tiên.'}
        </div>
      )}

      {pagination && totalPages > 1 && (
        <div className='mt-8 flex flex-col items-center justify-between gap-3 border-t border-stone-200/70 pt-6 sm:flex-row'>
          <p className='text-sm text-stone-500'>
            Hiển thị {(currentPage - 1) * pageSize + 1} -{' '}
            {Math.min(currentPage * pageSize, totalCount)} trên tổng số{' '}
            <span className='font-medium text-stone-700'>{totalCount}</span>{' '}
            thành viên
          </p>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              disabled={currentPage <= 1}
              onClick={() => updateParams({ page: currentPage - 1 })}
              className='inline-flex items-center gap-1 rounded-xl border border-stone-200/80 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'>
              <ChevronLeft className='size-4' />
              Trang trước
            </button>
            <span className='px-2 text-sm text-stone-600'>
              Trang {currentPage} / {totalPages}
            </span>
            <button
              type='button'
              disabled={currentPage >= totalPages}
              onClick={() => updateParams({ page: currentPage + 1 })}
              className='inline-flex items-center gap-1 rounded-xl border border-stone-200/80 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'>
              Trang sau
              <ChevronRight className='size-4' />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
