'use client'

import { Person } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import { getAvatarBg } from '@/utils/styleHelprs'
import Image from 'next/image'
import { useMemberListView } from '@/context/MemberListContext'
import DefaultAvatar from './DefaultAvatar'

interface FamilyNodeCardProps {
  person: Person
  role?: string // e.g., "Chồng", "Vợ"
  note?: string | null
  onClickCard?: () => void
  onClickName?: (e: React.MouseEvent) => void
  isRingVisible?: boolean
  isPlusVisible?: boolean
  level: number
}

export default function FamilyNodeCard({
  person,
  onClickCard,
  onClickName,
  isRingVisible = false,
  isPlusVisible = false
}: FamilyNodeCardProps) {
  const { showAvatar, setMemberModalId } = useMemberListView()

  const isPlaceholder =
    Boolean(person.is_private_placeholder) ||
    person.id.startsWith('private:') ||
    person.full_name === 'Thành viên riêng tư'
  const isDeceased = person.is_deceased

  const content = (
    <div
      onClick={isPlaceholder ? undefined : onClickCard}
      className={`group relative flex h-full flex-col items-center justify-start rounded-3xl px-1 py-2 transition-all duration-300 ${!isPlaceholder ? 'hover:-translate-y-1' : 'cursor-default opacity-85'} ${isDeceased ? 'opacity-80 grayscale-[0.4]' : ''} ${showAvatar ? 'w-20 bg-surface/70 backdrop-blur-xl hover:shadow-soft-hover sm:w-24 md:w-28' : 'px-3'} `}>
      {isRingVisible && (
        <div
          className={`absolute top-[15%] -left-2.5 z-100 flex size-5 items-center justify-center rounded-full text-sm font-medium text-stone-500 sm:-left-3.5 sm:size-6 sm:text-sm ${showAvatar ? 'bg-white shadow-sm' : ''} `}>
          <span className='leading-none'>💍</span>
        </div>
      )}
      {isPlusVisible && (
        <div
          className={`absolute top-[15%] -left-2.5 z-100 flex size-5 items-center justify-center rounded-full text-sm font-medium text-stone-500 sm:-left-3.5 sm:size-6 sm:text-sm ${showAvatar ? 'bg-white shadow-sm' : ''} `}>
          <span className='leading-none'>+</span>
        </div>
      )}

      {/* 1. Avatar */}
      {showAvatar && (
        <div className='relative z-10 mb-1.5 sm:mb-2'>
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm text-white shadow-lg ring-2 ring-white transition-transform duration-300 ${!isPlaceholder ? 'group-hover:scale-105' : ''} sm:h-12 sm:w-12 sm:text-sm md:h-14 md:w-14 md:text-sm ${isPlaceholder ? 'bg-stone-300 text-stone-600' : getAvatarBg(person.gender)} `}>
            {isPlaceholder ? (
              <span className='text-xs font-semibold text-stone-600 sm:text-sm'>
                🔒
              </span>
            ) : getAvatarUrl(person.avatar_url) ? (
              <Image
                unoptimized
                src={getAvatarUrl(person.avatar_url)!}
                alt={person.full_name}
                className='h-full w-full object-cover'
                width={64}
                height={64}
              />
            ) : (
              <DefaultAvatar gender={person.gender} size={64} />
            )}
          </div>
        </div>
      )}

      {/* 2. Gender Icon + Name */}
      <div className='relative z-10 flex w-full flex-col items-center justify-center gap-1 px-0.5 sm:px-1'>
        <div
          className={`text-center text-sm leading-tight font-medium transition-colors sm:text-sm md:text-sm ${isPlaceholder ? 'cursor-default text-stone-500 italic' : onClickName ? 'cursor-pointer text-stone-800 group-hover:text-amber-700 hover:underline' : 'cursor-pointer text-stone-800 group-hover:text-amber-800'} `}
          title={person.full_name}
          onClick={(e) => {
            if (!isPlaceholder && onClickName) {
              e.stopPropagation()
              e.preventDefault()
              onClickName(e)
            }
          }}>
          {showAvatar
            ? person.full_name
            : person.full_name.split(' ').map((word, i) => (
                <span key={i} className='block'>
                  {word}
                </span>
              ))}
        </div>
      </div>
    </div>
  )

  if (isPlaceholder) {
    return <div className='block w-fit select-none'>{content}</div>
  }

  if (onClickCard || onClickName) {
    return content
  }

  return (
    <button onClick={() => setMemberModalId(person.id)} className='block w-fit'>
      {content}
    </button>
  )
}
