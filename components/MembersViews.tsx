'use client'

import { useMemberListView } from '@/context/MemberListContext'
import MemberList from '@/components/MemberList'
import RootSelector from '@/components/RootSelector'
import { Person, Relationship } from '@/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { fetchFamilySubtree, mergeGraphDelta } from '@/utils/supabase/family-graph'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'

const FamilyTree = dynamic(() => import('@/components/FamilyTree'))
const MindmapTree = dynamic(() => import('@/components/MindmapTree'))
const BubbleMapTree = dynamic(
  () =>
    import('@/components/BubbleMapTree').catch((err) => {
      console.error('Failed to load BubbleMapTree:', err)
      return {
        default: () => (
          <div className='absolute inset-0 flex items-center justify-center rounded-2xl border border-stone-200/60 bg-stone-50 p-4 text-center text-stone-500'>
            Tính năng này không được hỗ trợ trên trình duyệt của bạn. Vui lòng
            cập nhật hoặc sử dụng trình duyệt khác.
          </div>
        )
      }
    }),
  { ssr: false }
)

interface MembersViewsProps {
  persons: Person[]
  listPersons?: Person[]
  relationships: Relationship[]
  initialGraphTruncated?: boolean
  initialGraphDepth?: number
  canEdit?: boolean
  listPagination?: {
    page: number
    pageSize: number
    total: number
    query: string
    filter: string
    sort: string
  }
}

export default function MembersViews({
  persons,
  listPersons = persons,
  relationships,
  initialGraphTruncated = false,
  initialGraphDepth = 3,
  canEdit = false,
  listPagination
}: MembersViewsProps) {
  const { view: currentView, rootId, setRootId } = useMemberListView()
  const [graphPersons, setGraphPersons] = useState(persons)
  const [graphRelationships, setGraphRelationships] = useState(relationships)
  const [graphDepth, setGraphDepth] = useState(initialGraphDepth)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isTruncated, setIsTruncated] = useState(initialGraphTruncated)
  const searchParams = useSearchParams()
  const hasRestored = useRef(false)

  // Prepare map and roots for tree views
  const { personsMap, roots, defaultRootId } = useMemo(() => {
    const pMap = new Map<string, Person>()
    graphPersons.forEach((p) => pMap.set(p.id, p))

    const childIds = new Set(
      graphRelationships
        .filter(
          (r) => r.type === 'biological_child' || r.type === 'adopted_child'
        )
        .map((r) => r.person_b)
    )

    let finalRootId = rootId

    // If no rootId is provided, fallback to generation 1 or earliest birth year
    if (!finalRootId || !pMap.has(finalRootId)) {
      const rootsFallback = graphPersons.filter((p) => !childIds.has(p.id))
      if (rootsFallback.length > 0) {
        const gen1 = rootsFallback.filter((p) => p.generation === 1)
        const sortByBirthYear = (a: Person, b: Person) => {
          const ya = a.birth_year ?? Infinity
          const yb = b.birth_year ?? Infinity
          return ya - yb
        }

        if (gen1.length > 0) {
          finalRootId = gen1.sort(sortByBirthYear)[0].id
        } else {
          finalRootId = rootsFallback.sort(sortByBirthYear)[0].id
        }
      } else if (graphPersons.length > 0) {
        finalRootId = graphPersons[0].id // ultimate fallback
      }
    }

    let calculatedRoots: Person[] = []
    if (finalRootId && pMap.has(finalRootId)) {
      calculatedRoots = [pMap.get(finalRootId)!]
    }

    return {
      personsMap: pMap,
      roots: calculatedRoots,
      defaultRootId: finalRootId
    }
  }, [graphPersons, graphRelationships, rootId])

  const activeRootId = rootId || defaultRootId

  const loadMore = async () => {
    if (!activeRootId || isLoadingMore || graphDepth >= 10) return
    setIsLoadingMore(true)
    try {
      const delta = await fetchFamilySubtree(createClient(), {
        rootId: activeRootId,
        maxDepth: graphDepth + 1,
        includeSpouses: true
      })
      const merged = mergeGraphDelta(new Map(graphPersons.map((person) => [person.id, person])), graphRelationships, delta)
      setGraphPersons([...merged.personsMap.values()])
      setGraphRelationships(merged.relationships)
      setGraphDepth(delta.maxDepth)
      setIsTruncated(delta.truncated)
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Khôi phục lựa chọn từ localStorage
  useEffect(() => {
    if (hasRestored.current) return

    const urlRootId = searchParams.get('rootId')

    if (!urlRootId) {
      try {
        const savedRootId = localStorage.getItem('members_rootId')

        if (!urlRootId && savedRootId && savedRootId !== rootId) {
          setRootId(savedRootId)
        }
      } catch (e) {
        console.warn('Failed to read from localStorage:', e)
      }
    }

    hasRestored.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lưu lựa chọn vào localStorage
  useEffect(() => {
    if (!hasRestored.current) return

    const timeout = setTimeout(() => {
      try {
        if (activeRootId) localStorage.setItem('members_rootId', activeRootId)
      } catch (e) {
        console.warn('Failed to write to localStorage:', e)
      }
    }, 100)

    return () => clearTimeout(timeout)
  }, [currentView, activeRootId])

  return (
    <>
      <main className='flex flex-1 flex-col overflow-auto bg-stone-50/50'>
        {currentView !== 'list' && persons.length > 0 && activeRootId && (
          <div className='relative z-20 mx-auto flex w-full max-w-7xl flex-col flex-wrap items-center gap-4 px-4 pt-6 pb-2 sm:flex-row sm:justify-between sm:px-6 lg:px-8'>
            <RootSelector persons={persons} currentRootId={activeRootId} />
            <div
              id='tree-toolbar-portal'
              className='flex flex-wrap items-center justify-center gap-2'
            />
          </div>
        )}

        {currentView === 'list' && (
          <div className='relative z-10 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8'>
            <MemberList
              key={
                listPagination
                  ? `${listPagination.page}:${listPagination.query}:${listPagination.filter}:${listPagination.sort}`
                  : 'all'
              }
              initialPersons={listPersons}
              relationships={relationships}
              canEdit={canEdit}
              pagination={listPagination}
            />
          </div>
        )}

        <div className='relative z-10 w-full flex-1'>
          {currentView === 'tree' && (
            <FamilyTree
              personsMap={personsMap}
              relationships={graphRelationships}
              roots={roots}
              canEdit={canEdit}
              truncated={isTruncated}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
            />
          )}
          {currentView === 'mindmap' && (
            <MindmapTree
              personsMap={personsMap}
              relationships={graphRelationships}
              roots={roots}
              canEdit={canEdit}
              truncated={isTruncated}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
            />
          )}
          {currentView === 'bubble' && (
            <BubbleMapTree
              personsMap={personsMap}
              relationships={relationships}
              roots={roots}
              canEdit={canEdit}
            />
          )}
        </div>
      </main>
    </>
  )
}
