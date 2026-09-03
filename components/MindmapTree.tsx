'use client'

import { Person, Relationship } from '@/types'
import { Share2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMemberListView } from '@/context/MemberListContext'
import { MindmapContextData, MindmapNode } from './MindmapNode'
import MindmapToolbar from './MindmapToolbar'

import { buildAdjacencyLists } from '@/utils/treeHelpers'

const DEFAULT_AUTO_COLLAPSE_LEVEL = 2

interface MindmapTreeProps {
  personsMap: Map<string, Person>
  relationships: Relationship[]
  roots: Person[]
  canEdit?: boolean
  truncated?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export default function MindmapTree({
  personsMap,
  relationships,
  roots,
  canEdit,
  truncated = false,
  isLoadingMore = false,
  onLoadMore
}: MindmapTreeProps) {
  const { showAvatar, setMemberModalId } = useMemberListView()
  const [hideDaughtersInLaw, setHideDaughtersInLaw] = useState(false)
  const [hideSonsInLaw, setHideSonsInLaw] = useState(false)
  const [hideDaughters, setHideDaughters] = useState(false)
  const [hideSons, setHideSons] = useState(false)
  const [hideMales, setHideMales] = useState(false)
  const [hideFemales, setHideFemales] = useState(false)
  const [hideExpandButtons, setHideExpandButtons] = useState(false)
  const [autoCollapseLevel, setAutoCollapseLevel] = useState(
    DEFAULT_AUTO_COLLAPSE_LEVEL
  )
  const [expandSignal, setExpandSignal] = useState<{
    type: 'expand' | 'collapse'
    ts: number
  } | null>(null)

  const ctx: MindmapContextData = useMemo(() => {
    const adj = buildAdjacencyLists(relationships, personsMap)

    return {
      personsMap,
      relationships,
      adj,
      hideDaughtersInLaw,
      hideSonsInLaw,
      hideDaughters,
      hideSons,
      hideMales,
      hideFemales,
      showAvatar,
      hideExpandButtons,
      autoCollapseLevel,
      expandSignal,
      setMemberModalId
    }
  }, [
    personsMap,
    relationships,
    hideDaughtersInLaw,
    hideSonsInLaw,
    hideDaughters,
    hideSons,
    hideMales,
    hideFemales,
    showAvatar,
    hideExpandButtons,
    autoCollapseLevel,
    expandSignal,
    setMemberModalId
  ])

  if (roots.length === 0) {
    return (
      <div className='p-12 text-center'>
        <div className='mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-stone-100'>
          <Share2 className='size-8 text-stone-300' />
        </div>
        <p className='font-medium text-stone-500'>Gia phả trống</p>
      </div>
    )
  }

  return (
    <div className='relative flex h-full min-h-[calc(100vh-140px)] w-full justify-start overflow-x-auto p-4 sm:p-6 lg:justify-center lg:p-8'>
      {truncated && onLoadMore && (
        <div className='absolute top-4 right-4 z-30 rounded-xl border border-stone-200 bg-white p-2'>
          <button type='button' className='rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60' disabled={isLoadingMore} onClick={onLoadMore}>
            {isLoadingMore ? 'Đang tải...' : 'Tải thêm thế hệ'}
          </button>
        </div>
      )}
      <MindmapToolbar
        hideDaughtersInLaw={hideDaughtersInLaw}
        setHideDaughtersInLaw={setHideDaughtersInLaw}
        hideSonsInLaw={hideSonsInLaw}
        setHideSonsInLaw={setHideSonsInLaw}
        hideDaughters={hideDaughters}
        setHideDaughters={setHideDaughters}
        hideSons={hideSons}
        setHideSons={setHideSons}
        hideMales={hideMales}
        setHideMales={setHideMales}
        hideFemales={hideFemales}
        setHideFemales={setHideFemales}
        hideExpandButtons={hideExpandButtons}
        setHideExpandButtons={setHideExpandButtons}
        autoCollapseLevel={autoCollapseLevel}
        setAutoCollapseLevel={setAutoCollapseLevel}
        setExpandSignal={setExpandSignal}
        canEdit={canEdit}
      />

      {/* Root Container */}
      <div
        id='export-container'
        className='min-w-max p-10 px-0 pb-20 font-sans sm:px-8'>
        {roots.map((root, index) => (
          <MindmapNode
            key={root.id}
            personId={root.id}
            level={0}
            isLast={index === roots.length - 1}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  )
}
