'use client'

import { Person, Relationship } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import { memo, useState } from 'react'
import DefaultAvatar from './DefaultAvatar'

import { getAvatarBg } from '@/utils/styleHelprs'
import { AdjacencyLists, getFilteredTreeData } from '@/utils/treeHelpers'

export interface MindmapContextData {
  personsMap: Map<string, Person>
  relationships: Relationship[]
  adj: AdjacencyLists
  hideDaughtersInLaw: boolean
  hideSonsInLaw: boolean
  hideDaughters: boolean
  hideSons: boolean
  hideMales: boolean
  hideFemales: boolean
  showAvatar: boolean
  hideExpandButtons: boolean
  autoCollapseLevel: number
  expandSignal: { type: 'expand' | 'collapse'; ts: number } | null
  setMemberModalId: (id: string | null) => void
}

export const getTreeData = (personId: string, ctx: MindmapContextData) => {
  return getFilteredTreeData(personId, ctx.personsMap, ctx.adj, {
    hideDaughtersInLaw: ctx.hideDaughtersInLaw,
    hideSonsInLaw: ctx.hideSonsInLaw,
    hideDaughters: ctx.hideDaughters,
    hideSons: ctx.hideSons,
    hideMales: ctx.hideMales,
    hideFemales: ctx.hideFemales
  })
}

export const MindmapNode = memo(
  ({
    personId,
    level = 0,
    isLast = false,
    ctx
  }: {
    personId: string
    level?: number
    isLast?: boolean
    ctx: MindmapContextData
  }) => {
    const data = getTreeData(personId, ctx)
    const [isExpanded, setIsExpanded] = useState(
      ctx.autoCollapseLevel > 0 ? level < ctx.autoCollapseLevel : level < 2
    )
    const [lastSignalTs, setLastSignalTs] = useState(0)
    const [lastCollapseLevel, setLastCollapseLevel] = useState(
      ctx.autoCollapseLevel
    )

    // React to global expand/collapse signal
    if (ctx.expandSignal && ctx.expandSignal.ts !== lastSignalTs) {
      setIsExpanded(ctx.expandSignal.type === 'expand')
      setLastSignalTs(ctx.expandSignal.ts)
    }

    // React to autoCollapseLevel changes
    if (ctx.autoCollapseLevel !== lastCollapseLevel) {
      setLastCollapseLevel(ctx.autoCollapseLevel)
      if (ctx.autoCollapseLevel > 0) {
        setIsExpanded(level < ctx.autoCollapseLevel)
      }
    }

    if (!data.person) return null

    const isPlaceholder =
      Boolean(data.person.is_private_placeholder) ||
      data.person.id.startsWith('private:') ||
      data.person.full_name === 'Thành viên riêng tư'
    const hasChildren = data.children.length > 0

    return (
      <div className={`relative py-1.5 ${level > 0 ? 'pl-6' : 'pl-0'}`}>
        {/* Draw the connecting L-shape line from the parent to this node */}
        {level > 0 && (
          <>
            <div
              className='absolute border-l-[1.5px] border-stone-300'
              style={{
                left: '0',
                top: isLast ? '-16px' : '-16px',
                bottom: isLast ? 'auto' : '-16px',
                height: isLast ? '40px' : '100%'
              }}></div>
            <div
              className='absolute rounded-bl-xl border-b-[1.5px] border-l-[1.5px] border-stone-300'
              style={{
                left: '0',
                top: '24px',
                width: '24px',
                height: '24px'
              }}></div>
          </>
        )}

        <div className='group relative z-10 flex items-center gap-2'>
          {/* Expand/Collapse Toggle or spacer */}
          <div className='z-10 flex size-5 shrink-0 items-center justify-center bg-transparent'>
            {hasChildren && !ctx.hideExpandButtons ? (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className='flex size-5 items-center justify-center rounded border border-stone-200 bg-white text-stone-500 transition-colors hover:bg-amber-50 hover:text-amber-600 focus:outline-none'
                aria-label={isExpanded ? 'Thu gọn' : 'Mở rộng'}>
                {isExpanded ? (
                  <ChevronDown strokeWidth={2.5} className='h-3.5 w-3.5' />
                ) : (
                  <ChevronRight strokeWidth={2.5} className='h-3.5 w-3.5' />
                )}
              </button>
            ) : (
              <div className='h-1.5 w-1.5 rounded-full bg-stone-300 ring-2 ring-white'></div>
            )}
          </div>

          {(() => {
            return (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className={`group/card relative flex cursor-pointer flex-wrap items-center gap-2 overflow-hidden rounded-2xl border border-stone-200/60 bg-white/60 p-2 transition-all duration-300 hover:border-amber-300 hover:bg-white/90 sm:p-2.5 ${data.person.is_deceased ? 'opacity-80 grayscale-[0.3]' : ''}`}
                onClick={() => {
                  if (!isPlaceholder) ctx.setMemberModalId(data.person.id)
                }}>
                <div className='relative z-10 flex w-full items-center gap-2.5'>
                  <div className='flex min-w-0 flex-1 items-center gap-2.5'>
                    {ctx.showAvatar && (
                      <div className='relative shrink-0'>
                        <div
                          className={`flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white shadow-md ring-2 ring-white transition-transform duration-300 group-hover/card:scale-105 ${getAvatarBg(data.person.gender)}`}>
                          {getAvatarUrl(data.person.avatar_url) ? (
                            <Image
                              unoptimized
                              src={getAvatarUrl(data.person.avatar_url)!}
                              alt={data.person.full_name}
                              width={40}
                              height={40}
                              className='h-full w-full object-cover'
                            />
                          ) : (
                            <DefaultAvatar
                              gender={data.person.gender}
                              size={40}
                            />
                          )}
                        </div>
                      </div>
                    )}
                    <div className='flex min-w-0 flex-1 flex-col'>
                      <span className='mb-0.5 truncate text-sm leading-tight font-medium text-stone-900 transition-colors group-hover/card:text-amber-700'>
                        {data.person.full_name}
                      </span>
                      <span className='flex items-center gap-1 truncate text-sm font-medium text-stone-500'>
                        <svg
                          className='size-3 shrink-0 text-stone-400'
                          fill='none'
                          viewBox='0 0 24 24'
                          stroke='currentColor'>
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
                          />
                        </svg>
                        <span className='truncate'>
                          {data.person.birth_year || 'Chưa rõ'}
                          {data.person.is_deceased &&
                            ` → ${data.person.death_lunar_year || data.person.death_year || 'Chưa rõ'}`}
                        </span>
                      </span>
                      {(data.person.is_deceased || data.person.is_in_law) && (
                        <div className='mt-1.5 flex shrink-0 flex-wrap items-center gap-1'>
                          {data.person.is_in_law && (
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-sm font-medium ${
                                data.person.gender === 'male'
                                  ? 'border-sky-200/60 bg-sky-50 text-sky-700'
                                  : data.person.gender === 'female'
                                    ? 'border-rose-200/60 bg-rose-50 text-rose-700'
                                    : 'border-stone-200/60 bg-stone-50 text-stone-700'
                              }`}>
                              {data.person.gender === 'male'
                                ? 'Rể'
                                : data.person.gender === 'female'
                                  ? 'Dâu'
                                  : 'Khách'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Spouses attached to node */}
                  {data.spouses.length > 0 && (
                    <div className='relative ml-1 flex flex-wrap gap-1.5 pl-2 before:absolute before:top-1/2 before:left-0 before:h-[70%] before:w-px before:-translate-y-1/2 before:bg-stone-200/80'>
                      {data.spouses.map((spouseData) => {
                        return (
                          <button
                            key={spouseData.person.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (
                                !Boolean(
                                  spouseData.person.is_private_placeholder
                                ) &&
                                !spouseData.person.id.startsWith('private:')
                              )
                                ctx.setMemberModalId(spouseData.person.id)
                            }}
                            className={`group/spouse flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-stone-200/60 bg-stone-50/50 p-1.5 transition-all hover:border-amber-300 hover:bg-white ${spouseData.person.is_deceased ? 'opacity-80 grayscale-[0.3]' : ''}`}
                            title={
                              spouseData.note ||
                              (spouseData.person.gender === 'male'
                                ? 'Chồng'
                                : 'Vợ')
                            }>
                            {ctx.showAvatar && (
                              <div
                                className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white shadow-sm ring-2 ring-white transition-transform duration-300 group-hover/spouse:scale-105 ${getAvatarBg(spouseData.person.gender)}`}>
                                {getAvatarUrl(spouseData.person.avatar_url) ? (
                                  <Image
                                    unoptimized
                                    src={getAvatarUrl(
                                      spouseData.person.avatar_url
                                    )!}
                                    alt={spouseData.person.full_name}
                                    width={32}
                                    height={32}
                                    className='h-full w-full object-cover'
                                  />
                                ) : (
                                  <DefaultAvatar
                                    gender={spouseData.person.gender}
                                    size={32}
                                  />
                                )}
                              </div>
                            )}
                            <span className='max-w-12.5 truncate text-center text-sm font-medium text-stone-600'>
                              {spouseData.person.full_name.split(' ').pop()}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })()}
        </div>

        {/* Children Container */}
        <AnimatePresence initial={false}>
          {hasChildren && isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className='relative z-0 -mt-4 origin-top overflow-hidden pt-4'>
              <div className='pb-1'>
                {data.children.map((child, index) => (
                  <MindmapNode
                    key={child.id}
                    personId={child.id}
                    level={level + 1}
                    isLast={index === data.children.length - 1}
                    ctx={ctx}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }
)
MindmapNode.displayName = 'MindmapNode'
