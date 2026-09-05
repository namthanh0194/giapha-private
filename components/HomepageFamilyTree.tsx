'use client'

import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useRef } from 'react'

import { usePanZoom } from '@/hooks/usePanZoom'
import type { Person, Relationship } from '@/types'

export interface HomepageFamilyTreeData {
  rootId: string
  persons: Person[]
  relationships: Relationship[]
  truncated: boolean
}

const childTypes = new Set(['biological_child', 'adopted_child'])

function TreeNode({
  person,
  level,
  childMap,
  people,
  seen
}: {
  person: Person
  level: number
  childMap: Map<string, string[]>
  people: Map<string, Person>
  seen: Set<string>
}) {
  const childIds = (childMap.get(person.id) ?? []).filter(
    (id) => !seen.has(id) && people.has(id)
  )

  return (
    <div className='flex flex-col items-center'>
      <div className='min-w-40 rounded-xl bg-white p-3 text-center text-primary'>
        <p className='text-sm font-medium'>Đời thứ {level}</p>
        <p className='mt-1 max-w-44 truncate text-sm text-secondary'>
          {person.full_name}
        </p>
      </div>
      {childIds.length > 0 && level < 6 && (
        <>
          <div className='h-6 w-px bg-amber-300' />
          <div className='flex items-start gap-5 border-t border-amber-300 pt-6'>
            {childIds.map((id) => {
              const child = people.get(id)
              if (!child) return null
              return (
                <div
                  key={id}
                  className='relative before:absolute before:-top-6 before:left-1/2 before:h-6 before:w-px before:bg-amber-300'>
                  <TreeNode
                    person={child}
                    level={level + 1}
                    childMap={childMap}
                    people={people}
                    seen={new Set([...seen, id])}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function HomepageFamilyTree({
  data
}: {
  data: HomepageFamilyTreeData
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scale, isDragging, handlers } = usePanZoom(containerRef)
  const { root, childMap, people } = useMemo(() => {
    const people = new Map(data.persons.map((person) => [person.id, person]))
    const childMap = new Map<string, string[]>()
    data.relationships.forEach((relationship) => {
      if (!childTypes.has(relationship.type)) return
      childMap.set(relationship.person_a, [
        ...(childMap.get(relationship.person_a) ?? []),
        relationship.person_b
      ])
    })
    childMap.forEach((ids) =>
      ids.sort(
        (left, right) =>
          (people.get(left)?.birth_order ?? Infinity) -
          (people.get(right)?.birth_order ?? Infinity)
      )
    )
    return { root: people.get(data.rootId), childMap, people }
  }, [data])

  if (!root) return null

  return (
    <div className='overflow-hidden rounded-3xl bg-primary text-white'>
      <div className='flex items-center justify-between gap-4 border-b border-white/15 px-5 py-4'>
        <div>
          <p className='font-serif text-xl font-semibold'>Cây gia phả</p>
          <p className='mt-1 text-sm text-stone-300'>Tối đa 6 đời · kéo để xem</p>
        </div>
        <div
          className='flex items-center gap-2'
          aria-label='Điều khiển phóng to cây gia phả'>
          <button
            type='button'
            onClick={handlers.handleZoomOut}
            className='flex size-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20'
            aria-label='Thu nhỏ'>
            <Minus className='size-4' />
          </button>
          <button
            type='button'
            onClick={handlers.handleResetZoom}
            className='flex size-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20'
            aria-label='Đặt lại tỷ lệ'>
            <RotateCcw className='size-4' />
          </button>
          <button
            type='button'
            onClick={handlers.handleZoomIn}
            className='flex size-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20'
            aria-label='Phóng to'>
            <Plus className='size-4' />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className={`min-h-[440px] overflow-auto p-6 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handlers.handleMouseDown}
        onMouseMove={handlers.handleMouseMove}
        onMouseUp={handlers.handleMouseUpOrLeave}
        onMouseLeave={handlers.handleMouseUpOrLeave}
        onClickCapture={handlers.handleClickCapture}>
        <div
          className='flex min-w-max justify-center p-8'
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
          <TreeNode
            person={root}
            level={1}
            childMap={childMap}
            people={people}
            seen={new Set([root.id])}
          />
        </div>
      </div>
      {data.truncated && (
        <p className='border-t border-white/15 px-5 py-3 text-sm text-stone-300'>
          Cây hiển thị tối đa sáu đời.
        </p>
      )}
    </div>
  )
}



