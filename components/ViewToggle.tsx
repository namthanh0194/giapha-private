'use client'

import { motion } from 'framer-motion'
import { Circle, List, ListTree, Network } from 'lucide-react'
import { useMemberListView } from '@/context/MemberListContext'

export type ViewMode = 'list' | 'tree' | 'mindmap' | 'bubble'

export default function ViewToggle() {
  const { view: currentView, setView } = useMemberListView()

  const tabs = [
    {
      id: 'list',
      label: 'Danh sách',
      icon: <List className='size-6 sm:size-4' />
    },
    {
      id: 'tree',
      label: 'Sơ đồ cây',
      icon: <Network className='size-6 sm:size-4' />
    },
    {
      id: 'mindmap',
      label: 'Mindmap',
      icon: <ListTree className='size-6 sm:size-4' />
    },
    {
      id: 'bubble',
      label: 'Bong bóng',
      icon: <Circle className='size-6 sm:size-4' />
    }
  ] as const

  return (
    <div className='relative z-10 mx-auto mt-4 mb-2 flex w-fit rounded-full border border-stone-200/60 bg-stone-200/50 p-1.5 backdrop-blur-sm'>
      {tabs.map((tab) => {
        const isActive = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => setView(tab.id as ViewMode)}
            className={`relative z-10 flex min-h-11 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-300 ease-in-out sm:px-6 sm:py-2.5 ${
              isActive
                ? 'text-stone-900'
                : 'text-stone-500 hover:text-stone-800'
            }`}>
            {isActive && (
              <motion.div
                layoutId='activeTab'
                className='absolute inset-0 z-[-1] rounded-full border border-stone-200/60 bg-white'
                transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              />
            )}
            <span
              className={`transition-colors duration-300 ${isActive ? 'text-amber-700' : 'text-stone-400'}`}>
              {tab.icon}
            </span>
            <span className='hidden sm:block'>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
