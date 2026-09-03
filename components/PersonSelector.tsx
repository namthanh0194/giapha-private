'use client'

import { Person } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Database, Search } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import DefaultAvatar from './DefaultAvatar'
import { FemaleIcon, MaleIcon } from './GenderIcons'

// ── Helpers ──────────────────────────────────────────────────────────────────
const getGenderStyle = (gender: string) => {
  if (gender === 'male') return 'bg-sky-100 text-sky-600'
  if (gender === 'female') return 'bg-rose-100 text-rose-600'
  return 'bg-stone-100 text-stone-600'
}

const getAvatarBg = (gender: string) => {
  if (gender === 'male') return 'bg-linear-to-br from-sky-400 to-sky-700'
  if (gender === 'female') return 'bg-linear-to-br from-rose-400 to-rose-700'
  return 'bg-linear-to-br from-stone-400 to-stone-600'
}

type SearchPerson = {
  id: string
  full_name: string
  gender: Person['gender']
  birth_year: number | null
  avatar_url: string | null
  is_private_placeholder: boolean
}

export default function PersonSelector({
  persons,
  selectedId,
  onSelect,
  placeholder = 'Chọn người...',
  label = 'Gốc hiển thị',
  className = 'w-full sm:w-72',
  showAllOption = false,
  allOptionLabel = 'Toàn bộ dữ liệu'
}: {
  persons: Person[]
  selectedId?: string | null
  onSelect: (id: string | null) => void
  placeholder?: string
  label?: string
  className?: string
  showAllOption?: boolean
  allOptionLabel?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SearchPerson[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentPerson = persons.find((p) => p.id === selectedId)

  useEffect(() => {
    if (!isOpen || searchTerm.trim().length < 2) return

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search/persons?q=${encodeURIComponent(searchTerm.trim())}&limit=20`,
          { signal: controller.signal }
        )
        if (!response.ok) return
        const payload = (await response.json()) as { persons: SearchPerson[] }
        setSearchResults(payload.persons ?? [])
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
  }, [isOpen, searchTerm])

  const handleSelect = (personId: string | null) => {
    onSelect(personId)
    setIsOpen(false)
    setSearchTerm('')
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`group flex w-full items-center gap-3 rounded-xl border bg-white/60 px-3 py-2 text-sm transition-all duration-300 focus:ring-2 focus:ring-amber-500/20 focus:outline-none ${isOpen ? 'border-amber-300 bg-white ring-2 ring-amber-500/10' : 'border-stone-200/60 hover:border-amber-300 hover:bg-white/90'}`}>
        <div className='relative shrink-0'>
          <div
            className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm font-medium shadow-xs ring-2 ring-white ${
              currentPerson
                ? `${getAvatarBg(currentPerson.gender)} text-white`
                : showAllOption && selectedId === null
                  ? 'bg-stone-500 text-white'
                  : 'bg-stone-100 text-stone-400'
            }`}>
            {currentPerson ? (
              getAvatarUrl(currentPerson.avatar_url) ? (
                <Image
                  unoptimized
                  src={getAvatarUrl(currentPerson.avatar_url)!}
                  alt={currentPerson.full_name}
                  width={32}
                  height={32}
                  className='h-full w-full object-cover'
                />
              ) : (
                <DefaultAvatar gender={currentPerson.gender} size={32} />
              )
            ) : showAllOption && selectedId === null ? (
              <Database className='size-4' />
            ) : (
              '?'
            )}
          </div>
          {currentPerson && (
            <div
              className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full shadow-xs ring-2 ring-white ${getGenderStyle(currentPerson.gender)}`}>
              {currentPerson.gender === 'male' ? (
                <MaleIcon className='size-2.5' />
              ) : currentPerson.gender === 'female' ? (
                <FemaleIcon className='size-2.5' />
              ) : null}
            </div>
          )}
        </div>

        <div className='min-w-0 flex-1 text-left'>
          {label && (
            <p className='mb-0.5 text-sm leading-none font-medium text-stone-400'>
              {label}
            </p>
          )}
          <p className='truncate leading-tight font-medium text-stone-800 select-none'>
            {currentPerson
              ? currentPerson.full_name
              : showAllOption && selectedId === null
                ? allOptionLabel
                : placeholder}
          </p>
          {currentPerson && currentPerson.birth_year && (
            <p className='mt-0.5 text-sm leading-none text-stone-400 select-none'>
              Sinh năm {currentPerson.birth_year}
            </p>
          )}
        </div>

        <ChevronDown
          className={`size-4 text-stone-400 transition-transform duration-300 group-hover:text-amber-600 ${
            isOpen ? 'rotate-180 text-amber-600' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className='absolute z-50 mt-2 flex max-h-80 w-full flex-col overflow-hidden rounded-xl border border-stone-200/80 bg-white/95 ring-1 ring-black/5 backdrop-blur-xl'>
            <div className='sticky top-0 z-10 border-b border-stone-100/80 bg-stone-50/50 p-2 backdrop-blur-sm'>
              <div className='relative'>
                <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <input
                  type='text'
                  className='w-full rounded-lg border border-stone-200/80 bg-white py-2 pr-3 pl-9 text-sm text-stone-900 placeholder-stone-400 transition-all outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20'
                  placeholder='Tìm kiếm (tối thiểu 2 ký tự)...'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className='custom-scrollbar flex-1 overflow-y-auto p-1.5'>
              {showAllOption && searchTerm.toLowerCase() === '' && (
                <button
                  onClick={() => handleSelect(null)}
                  className={`group/item mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                    selectedId === null
                      ? 'border border-amber-200/50 bg-amber-50 text-amber-900'
                      : 'border border-transparent text-stone-700 hover:bg-stone-100/80'
                  }`}>
                  <div className='relative shrink-0'>
                    <div className='flex size-8 items-center justify-center rounded-full bg-stone-500 text-white shadow-xs ring-1 ring-white'>
                      <Database className='size-4' />
                    </div>
                  </div>
                  <div className='min-w-0 flex-1 text-left'>
                    <p
                      className={`truncate ${selectedId === null ? 'font-medium' : 'font-medium group-hover/item:text-stone-900'}`}>
                      {allOptionLabel}
                    </p>
                  </div>
                  {selectedId === null && (
                    <Check className='size-4 shrink-0 text-amber-600' />
                  )}
                </button>
              )}

              {searchTerm.trim().length >= 2 && searchResults.length > 0 ? (
                <div className='space-y-0.5'>
                  {searchResults.map((person) => {
                    const isSelected = person.id === selectedId
                    return (
                      <button
                        key={person.id}
                        onClick={() => !person.is_private_placeholder && handleSelect(person.id)}
                        disabled={person.is_private_placeholder}
                        className={`group/item flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                          isSelected
                            ? 'border border-amber-200/50 bg-amber-50 text-amber-900'
                            : 'border border-transparent text-stone-700 hover:bg-stone-100/80 disabled:cursor-not-allowed disabled:opacity-60'
                        }`}>
                        <div className='relative shrink-0'>
                          <div
                            className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white shadow-xs ring-1 ring-white ${getAvatarBg(person.gender)}`}>
                            {getAvatarUrl(person.avatar_url) ? (
                              <Image
                                unoptimized
                                src={getAvatarUrl(person.avatar_url)!}
                                alt={person.full_name}
                                width={32}
                                height={32}
                                className='h-full w-full object-cover'
                              />
                            ) : (
                              <DefaultAvatar gender={person.gender} size={32} />
                            )}
                          </div>
                          <div
                            className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full shadow-xs ring-1 ring-white ${getGenderStyle(person.gender)}`}>
                            {person.gender === 'male' ? (
                              <MaleIcon className='size-2.5' />
                            ) : person.gender === 'female' ? (
                              <FemaleIcon className='size-2.5' />
                            ) : null}
                          </div>
                        </div>

                        <div className='min-w-0 flex-1 text-left'>
                          <p
                            className={`truncate ${isSelected ? 'font-medium' : 'font-medium group-hover/item:text-stone-900'}`}>
                            {person.full_name}{' '}
                            {person.birth_year ? (
                              <span className='font-normal text-stone-400'>
                                ({person.birth_year})
                              </span>
                            ) : null}
                          </p>
                        </div>

                        {isSelected && (
                          <Check className='size-4 shrink-0 text-amber-600' />
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center gap-2 px-4 py-8 text-center'>
                  <div className='mb-1 flex size-10 items-center justify-center rounded-full bg-stone-100'>
                    <Search className='size-5 text-stone-300' />
                  </div>
                  <div className='text-sm font-medium text-stone-600'>
                    {searchTerm.trim().length < 2
                      ? 'Nhập ít nhất 2 ký tự để tìm kiếm'
                      : 'Không tìm thấy kết quả'}
                  </div>
                  <div className='text-sm text-stone-400'>
                    {searchTerm.trim().length < 2
                      ? 'Hỗ trợ gõ tiếng Việt có hoặc không dấu'
                      : 'Thử tìm với tên khác'}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}