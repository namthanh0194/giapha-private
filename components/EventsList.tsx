'use client'

import CustomEventModal from '@/components/modal/CustomEventModal'
import { useMemberListView } from '@/context/MemberListContext'
import { getZodiacSign } from '@/utils/dateHelpers'
import {
  computeEvents,
  CustomEventRecord,
  FamilyEvent
} from '@/utils/eventHelpers'
import { motion } from 'framer-motion'
import {
  AlignLeft,
  Cake,
  CalendarDays,
  Clock,
  Flower,
  MapPin,
  Plus,
  Star
} from 'lucide-react'
import { Solar } from 'lunar-javascript'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

interface EventsListProps {
  persons: {
    id: string
    full_name: string
    birth_year: number | null
    birth_month: number | null
    birth_day: number | null
    death_year: number | null
    death_month: number | null
    death_day: number | null
    death_lunar_year: number | null
    death_lunar_month: number | null
    death_lunar_day: number | null
    is_deceased: boolean
  }[]
  customEvents?: CustomEventRecord[]
  canEdit?: boolean
}

const DAY_LABELS: Record<string, string> = {
  '-1': 'Hôm qua',
  '0': 'Hôm nay',
  '1': 'Ngày mai'
}

function daysUntilLabel(days: number): string {
  if (days.toString() in DAY_LABELS) return DAY_LABELS[days.toString()]
  if (days < 0) {
    const abs = Math.abs(days)
    if (abs <= 30) return `${abs} ngày trước`
    if (abs <= 60) return `${Math.ceil(abs / 7)} tuần trước`
    return `${Math.ceil(abs / 30)} tháng trước`
  }
  if (days <= 30) return `${days} ngày nữa`
  if (days <= 60) return `${Math.ceil(days / 7)} tuần nữa`
  return `${Math.ceil(days / 30)} tháng nữa`
}

function EventCard({
  event,
  index,
  canEdit = true,
  onEditCustomEvent
}: {
  event: FamilyEvent
  index: number
  canEdit?: boolean
  onEditCustomEvent: (e: FamilyEvent) => void
}) {
  const isBirthday = event.type === 'birthday'
  const isCustom = event.type === 'custom_event'
  const isToday = event.daysUntil === 0
  const isPast = event.daysUntil < 0
  const isSoon = event.daysUntil > 0 && event.daysUntil <= 7

  const { setMemberModalId } = useMemberListView()

  const isClickable = !isCustom || canEdit
  const handleClick = () => {
    if (!isClickable) return
    if (isCustom) {
      onEditCustomEvent(event)
    } else if (event.personId) {
      setMemberModalId(event.personId)
    }
  }

  // Compute age or years since for display
  const yearsInfo = (() => {
    if (!event.originYear) return null
    const now = new Date().getFullYear()
    const diff = now - event.originYear
    if (diff <= 0) return null
    if (isBirthday) return `${diff} tuổi`
    if (event.type === 'death_anniversary') return `${diff} năm`
    return null
  })()

  const dateLabel = (() => {
    const weekdays = [
      'Chủ nhật',
      'Thứ hai',
      'Thứ ba',
      'Thứ tư',
      'Thứ năm',
      'Thứ sáu',
      'Thứ bảy'
    ]
    const d = event.nextOccurrence
    const dayOfWeek = weekdays[d.getDay()]
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()

    let label = `${dayOfWeek}, ngày ${day}/${month}`
    if (event.type === 'custom_event') {
      label += `/${year}`
    }
    if (event.type === 'death_anniversary') {
      label += ` (Âm lịch: ${event.eventDateLabel.replace(' ÂL', '')})`
    }
    return label
  })()

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      onClick={handleClick}
      className={`group flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-all sm:gap-4 sm:p-4 ${
        isClickable ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'
      } ${
        isToday
          ? 'border-amber-300 bg-amber-50'
          : isPast
            ? 'border-stone-200/50 bg-stone-50/60'
            : isBirthday
              ? 'border-stone-200/60 bg-white/80 hover:border-blue-200'
              : isCustom
                ? 'border-stone-200/60 bg-white/80 hover:border-purple-200'
                : 'border-stone-200/60 bg-white/80 hover:border-rose-200'
      }`}>
      {/* Icon */}
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11 ${
          isToday
            ? 'bg-amber-100 text-amber-600'
            : isPast
              ? 'bg-stone-100 text-stone-400'
              : isBirthday
                ? 'bg-blue-50 text-blue-500'
                : isCustom
                  ? 'bg-purple-50 text-purple-500'
                  : 'bg-rose-50 text-rose-500'
        }`}>
        {isBirthday ? (
          <Cake className='size-4.5 sm:size-5' />
        ) : isCustom ? (
          <Star className='size-4.5 sm:size-5' />
        ) : (
          <Flower className='size-4.5 sm:size-5' />
        )}
      </div>

      {/* Info */}
      <div className='min-w-0 flex-1'>
        {/* Top row: name + badge */}
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <p
            className={`truncate text-sm font-medium transition-colors sm:text-sm ${
              isPast
                ? 'text-stone-500'
                : 'text-stone-800 group-hover:text-amber-700'
            }`}>
            {event.personName}
          </p>
          {isBirthday &&
            event.originDay &&
            event.originMonth &&
            getZodiacSign(event.originDay, event.originMonth) && (
              <span className='shrink-0 rounded-md border border-indigo-200/60 bg-indigo-50 px-1.5 py-0.5 font-sans text-sm font-medium whitespace-nowrap text-indigo-700'>
                {getZodiacSign(event.originDay, event.originMonth)}
              </span>
            )}
          {/* Days badge — inline with name */}
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-sm leading-tight font-medium whitespace-nowrap ${
              isToday
                ? 'bg-amber-400 text-white'
                : isPast
                  ? 'bg-stone-200/80 text-stone-500'
                  : isSoon
                    ? 'bg-red-100 text-red-600'
                    : 'bg-stone-100 text-stone-500'
            }`}>
            {isToday && (
              <span className='relative flex size-1.5'>
                <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-200 opacity-75' />
                <span className='relative inline-flex size-1.5 rounded-full bg-white' />
              </span>
            )}
            {!isToday && <Clock className='size-2.5' />}
            {daysUntilLabel(event.daysUntil)}
          </span>
        </div>

        {/* Details */}
        <div className='mt-1 flex flex-col gap-0.5'>
          <p className='flex items-center gap-1.5 text-sm leading-snug text-stone-500 sm:text-sm'>
            <CalendarDays className='size-3.5 shrink-0' />
            <span className='font-medium text-stone-600'>{dateLabel}</span>
            {yearsInfo && <span className='text-stone-400'>· {yearsInfo}</span>}
          </p>

          {event.location && (
            <p className='flex items-center gap-1.5 text-sm leading-snug text-stone-500 sm:text-sm'>
              <MapPin className='size-3.5 shrink-0' />
              <span className='truncate'>{event.location}</span>
            </p>
          )}
          {event.content && (
            <p className='mt-0.5 flex items-start gap-1.5 text-sm leading-snug text-stone-400 sm:text-sm'>
              <AlignLeft className='mt-0.5 size-3.5 shrink-0' />
              <span className='line-clamp-2'>{event.content}</span>
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function EventsList({
  persons,
  customEvents = [],
  canEdit = true
}: EventsListProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<
    'all' | 'birthday' | 'death_anniversary' | 'custom_event' | 'past'
  >('all')
  const [showCount, setShowCount] = useState(20)
  const [showDeceasedBirthdays, setShowDeceasedBirthdays] = useState(false)

  // Custom Event Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomEvent, setEditingCustomEvent] =
    useState<CustomEventRecord | null>(null)

  const handleOpenEditModal = (event: FamilyEvent) => {
    const rawEvent = customEvents.find((ce) => ce.id === event.personId)
    if (rawEvent) {
      setEditingCustomEvent(rawEvent)
      setIsModalOpen(true)
    }
  }

  const handleOpenCreateModal = () => {
    setEditingCustomEvent(null)
    setIsModalOpen(true)
  }

  const handleModalSuccess = () => {
    router.refresh()
  }

  const [todayDate] = useState(() => {
    const today = new Date()
    const weekdays = [
      'Chủ nhật',
      'Thứ hai',
      'Thứ ba',
      'Thứ tư',
      'Thứ năm',
      'Thứ sáu',
      'Thứ bảy'
    ]
    const dayOfWeek = weekdays[today.getDay()]
    const solarStr = `${dayOfWeek}, ngày ${today.getDate()} tháng ${today.getMonth() + 1} năm ${today.getFullYear()}`
    let lunarStr = ''
    try {
      const solar = Solar.fromYmd(
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate()
      )
      const lunar = solar.getLunar()
      const lMonthRaw = lunar.getMonth()
      const isLeap = lMonthRaw < 0
      const lMonth = Math.abs(lMonthRaw).toString().padStart(2, '0')
      const lDay = lunar.getDay().toString().padStart(2, '0')
      lunarStr = `${lDay}/${lMonth}${isLeap ? ' nhuận' : ''} ÂL`
    } catch (e) {
      console.error(e)
    }
    return { solar: solarStr, lunar: lunarStr }
  })

  const allEvents = useMemo(
    () => computeEvents(persons, customEvents),
    [persons, customEvents]
  )

  const filtered = useMemo(() => {
    let result = allEvents
    if (filter === 'past') {
      // Past tab: all event types from the past year
      return result
        .filter((e) => e.daysUntil < 0 && e.daysUntil >= -365)
        .sort((a, b) => b.daysUntil - a.daysUntil) // most recent first
    }
    if (filter !== 'all') {
      result = result.filter((e) => e.type === filter)
    }
    if (!showDeceasedBirthdays) {
      result = result.filter((e) => !(e.type === 'birthday' && e.isDeceased))
    }
    // Only show upcoming events (daysUntil >= 0) for non-past tabs
    return result.filter((e) => e.daysUntil >= 0 && e.daysUntil <= 365)
  }, [allEvents, filter, showDeceasedBirthdays])

  const visible = filtered.slice(0, showCount)

  const todayCount = allEvents.filter((e) => e.daysUntil === 0).length
  const soonCount = allEvents.filter(
    (e) => e.daysUntil > 0 && e.daysUntil <= 7
  ).length

  return (
    <div className='space-y-5'>
      {/* Summary banner */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className='relative mb-8 flex flex-col justify-between gap-6 overflow-hidden rounded-3xl border border-stone-200/60 bg-white p-6 transition-all duration-300 hover:border-stone-400 sm:flex-row sm:items-center sm:p-8'>
        {/* Subtle background flair */}
        <div className='pointer-events-none absolute top-0 right-0 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-50/50 opacity-50 blur-3xl'></div>

        <div className='relative flex items-center gap-4 sm:gap-6'>
          <div className='flex size-16 shrink-0 items-center justify-center rounded-2xl border border-stone-100 bg-stone-50 text-stone-600'>
            <CalendarDays className='size-8' />
          </div>
          <div>
            <p className='text-sm font-medium text-stone-800 sm:text-sm'>
              {todayDate.solar}
            </p>
            {todayDate.lunar && (
              <div className='mt-2.5 inline-flex flex-wrap items-center gap-2 rounded-full border border-stone-100 bg-stone-50 px-3.5 py-1'>
                <span className='text-sm font-medium text-stone-500'>
                  Âm lịch:
                </span>
                <span className='text-sm font-medium text-stone-700'>
                  {todayDate.lunar}
                </span>
              </div>
            )}
            {(todayCount > 0 || soonCount > 0) && (
              <p className='mt-3 flex items-start gap-2.5 text-sm font-medium text-stone-500 sm:items-center'>
                <span className='relative mt-1 flex size-2.5 shrink-0 sm:mt-0'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75'></span>
                  <span className='relative inline-flex size-2.5 rounded-full bg-amber-500'></span>
                </span>
                <span className='flex flex-wrap items-center gap-1.5'>
                  {todayCount > 0 && (
                    <span className='font-medium text-stone-700'>
                      {todayCount} sự kiện hôm nay
                    </span>
                  )}
                  {todayCount > 0 && soonCount > 0 && (
                    <span className='hidden sm:inline'>·</span>
                  )}
                  {soonCount > 0 && (
                    <span>{soonCount} sự kiện trong 7 ngày tới</span>
                  )}
                </span>
              </p>
            )}
          </div>
        </div>

        {canEdit && <button
          onClick={handleOpenCreateModal}
          className='btn-primary relative z-10 w-full sm:w-auto'>
          <Plus className='size-5 text-stone-300' />
          <span>Thêm sự kiện</span>
        </button>}
      </motion.div>

      {/* Controls */}
      <div className='flex flex-col gap-3'>
        {/* Filter tabs */}
        <div className='flex flex-wrap items-center gap-2'>
          {(
            [
              { key: 'all', label: 'Tất cả' },
              { key: 'birthday', label: 'Sinh nhật' },
              { key: 'death_anniversary', label: 'Ngày giỗ' },
              { key: 'custom_event', label: 'Tuỳ chỉnh' },
              { key: 'past', label: 'Đã qua' }
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setFilter(tab.key)
                setShowCount(20)
              }}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                filter === tab.key
                  ? filter === 'past'
                    ? 'bg-stone-600 text-white'
                    : 'bg-amber-500 text-white'
                  : 'border border-stone-200/60 bg-white/80 text-stone-600 hover:border-amber-200 hover:text-amber-700'
              }`}>
              {tab.label}
            </button>
          ))}
          <span className='ml-auto self-center text-sm text-stone-400'>
            {filtered.length} sự kiện{filter === 'past' ? ' trong năm qua' : ''}
          </span>
        </div>

        {/* Toggle options — hide when viewing past events */}
        {filter !== 'past' && (
          <div className='flex px-1'>
            <label className='flex cursor-pointer items-center gap-2.5 text-sm font-medium text-stone-600 transition-colors select-none hover:text-stone-900'>
              <input
                type='checkbox'
                checked={showDeceasedBirthdays}
                onChange={(e) => setShowDeceasedBirthdays(e.target.checked)}
                className='size-4 rounded-md border-stone-300 text-amber-500 transition-all focus:ring-amber-500'
              />
              Hiển thị sinh nhật của người đã mất
            </label>
          </div>
        )}
      </div>

      {/* Event list */}
      {visible.length === 0 ? (
        <div className='py-16 text-center text-stone-400'>
          <CalendarDays className='mx-auto mb-3 size-10 opacity-40' />
          <p className='font-medium'>Không có sự kiện nào</p>
          <p className='mt-1 text-sm'>
            Hãy bổ sung ngày sinh hoặc ngày mất cho thành viên
          </p>
        </div>
      ) : (
        <div className='space-y-2.5'>
          {visible.map((event, i) => (
            <EventCard
              key={`${event.personId}-${event.type}-${event.eventDateLabel}`}
              event={event}
              index={i}
              canEdit={canEdit}
              onEditCustomEvent={handleOpenEditModal}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {filtered.length > showCount && (
        <button
          onClick={() => setShowCount((n) => n + 20)}
          className='btn w-full'>
          Xem thêm {filtered.length - showCount} sự kiện…
        </button>
      )}

      {canEdit && <CustomEventModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        eventToEdit={editingCustomEvent}
        canEdit={canEdit}
      />}
    </div>
  )
}
