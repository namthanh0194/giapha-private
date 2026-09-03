'use client'

import { GalleryItem } from '@/types'
import dayjs from 'dayjs'
import { CalendarDays, Maximize2, X, Clock } from 'lucide-react'
import { useState, useMemo } from 'react'

import { deleteGalleryItemAction } from '@/app/actions/gallery'
import Image from 'next/image'
import DialogShell from '@/components/modal/DialogShell'

interface GalleryGridProps {
  items: GalleryItem[]
  isAdmin?: boolean
  viewMode?: 'grid' | 'timeline'
  onEdit?: (item: GalleryItem) => void
  onDeleteSuccess?: (id: string) => void
}

export default function GalleryGrid({
  items,
  isAdmin,
  viewMode = 'grid',
  onEdit,
  onDeleteSuccess
}: GalleryGridProps) {
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Group items by year/month for timeline mode
  const timelineGroups = useMemo(() => {
    if (viewMode !== 'timeline') return []

    const datedItems: { item: GalleryItem; year: number; month: number }[] = []
    const undatedItems: GalleryItem[] = []

    items.forEach((item) => {
      if (item.event_date) {
        const d = dayjs(item.event_date)
        datedItems.push({
          item,
          year: d.year(),
          month: d.month() + 1
        })
      } else {
        undatedItems.push(item)
      }
    })

    // Sort dated items descending
    datedItems.sort((a, b) => {
      const timeA = dayjs(a.item.event_date).valueOf()
      const timeB = dayjs(b.item.event_date).valueOf()
      return timeB - timeA
    })

    // Group by Year
    const groupsMap = new Map<number, GalleryItem[]>()
    datedItems.forEach(({ item, year }) => {
      if (!groupsMap.has(year)) {
        groupsMap.set(year, [])
      }
      groupsMap.get(year)!.push(item)
    })

    const groups = Array.from(groupsMap.entries()).map(
      ([year, groupItems]) => ({
        year: String(year),
        items: groupItems
      })
    )

    if (undatedItems.length > 0) {
      groups.push({
        year: 'Kỷ niệm khác',
        items: undatedItems
      })
    }

    return groups
  }, [items, viewMode])

  const handleDelete = async (item: GalleryItem) => {
    if (!confirm('Bạn có chắc chắn muốn xóa hình ảnh này?')) return
    setIsDeleting(true)
    try {
      const result = await deleteGalleryItemAction(item.id, item.version ?? 1)
      if (!result.success) {
        alert(
          result.errorId
            ? result.error + ' Mã sự cố: ' + result.errorId
            : result.error || 'Đã xảy ra lỗi khi xóa hình ảnh.'
        )
        return
      }

      setSelectedItem(null)
      if (onDeleteSuccess) onDeleteSuccess(item.id)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!items || items.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center rounded-3xl border border-stone-100 bg-white px-4 py-20 text-center'>
        <div className='mb-4 flex size-20 items-center justify-center rounded-full border border-stone-100 bg-stone-50'>
          <Maximize2 className='size-8 text-stone-300' />
        </div>
        <h3 className='mb-2 text-xl font-semibold text-stone-700'>
          Chưa có hình ảnh nào
        </h3>
        <p className='max-w-sm text-stone-500'>
          Hãy là người đầu tiên thêm hình ảnh để lưu giữ những kỷ niệm đẹp của
          dòng họ.
        </p>
      </div>
    )
  }

  return (
    <>
      {viewMode === 'grid' ? (
        <div className='columns-1 gap-4 space-y-4 sm:columns-2 lg:columns-3 xl:columns-4'>
          {items.map((item) => (
            <button
              key={item.id}
              type='button'
              aria-label={item.title}
              className='group relative block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-2xl bg-stone-100 text-left shadow-sm transition-all duration-500 hover:shadow-xl'
              onClick={() => setSelectedItem(item)}>
              {/* Image */}
              <Image
                unoptimized
                src={item.image_url}
                alt={item.title}
                width={800}
                height={600}
                className='w-full object-cover transition-transform duration-700 group-hover:scale-105'
                loading='lazy'
              />

              {/* Overlay */}
              <div className='absolute inset-0 flex flex-col justify-end bg-linear-to-t from-stone-900/80 via-stone-900/20 to-transparent p-5 opacity-0 transition-opacity duration-300 group-hover:opacity-100'>
                <div className='translate-y-4 transform transition-transform duration-300 group-hover:translate-y-0'>
                  <span className='mb-1 block line-clamp-2 text-sm leading-tight font-semibold text-white'>
                    {item.title}
                  </span>
                  {item.event_date && (
                    <p className='flex items-center gap-1.5 text-sm font-medium text-stone-300'>
                      <CalendarDays className='size-3.5' />
                      {dayjs(item.event_date).format('DD/MM/YYYY')}
                    </p>
                  )}
                </div>
              </div>

              {/* Top Right Icon */}
              <div className='absolute top-4 right-4 opacity-0 transition-opacity delay-100 duration-300 group-hover:opacity-100'>
                <div className='rounded-full bg-white/20 p-2 text-white backdrop-blur-md'>
                  <Maximize2 className='size-4' aria-hidden='true' />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        /* Timeline View */
        <div className='relative space-y-12 pl-4 before:absolute before:top-3 before:bottom-3 before:left-3 before:w-0.5 before:bg-linear-to-b before:from-amber-500 before:via-stone-300 before:to-stone-200 sm:pl-8 sm:before:left-7'>
          {timelineGroups.map((group) => (
            <div key={group.year} className='relative'>
              {/* Timeline Header Badge */}
              <div className='relative mb-6 flex items-center gap-3'>
                <div className='absolute -left-7 z-10 flex size-6 items-center justify-center rounded-full border-4 border-stone-50 bg-amber-600 sm:-left-11 sm:size-7'>
                  <Clock className='size-3 text-white' aria-hidden='true' />
                </div>
                <h2 className='inline-block bg-stone-50/90 pr-4 font-serif text-2xl font-semibold text-stone-900 backdrop-blur-xs sm:text-3xl'>
                  {group.year}
                </h2>
              </div>

              {/* Items under this year */}
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    aria-label={item.title}
                    onClick={() => setSelectedItem(item)}
                    className='group flex w-full cursor-pointer flex-col justify-between rounded-2xl border border-stone-200/80 bg-white/80 p-4 text-left backdrop-blur-xl transition-all duration-300 hover:-translate-y-1'>
                    <div>
                      <div className='relative mb-4 aspect-16/10 overflow-hidden rounded-xl bg-stone-100'>
                        <Image
                          unoptimized
                          src={item.image_url}
                          alt={item.title}
                          width={600}
                          height={400}
                          className='h-full w-full object-cover transition-transform duration-500 group-hover:scale-105'
                          loading='lazy'
                        />
                        <div className='absolute top-2 right-2 rounded-full bg-black/40 p-1.5 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100'>
                          <Maximize2 className='size-3.5' />
                        </div>
                      </div>

                      {item.event_date && (
                        <span className='mb-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-800'>
                          <CalendarDays className='size-3' />
                          {dayjs(item.event_date).format('DD/MM/YYYY')}
                        </span>
                      )}

                      <span className='block line-clamp-2 text-sm leading-snug font-semibold text-stone-900 transition-colors group-hover:text-amber-700'>
                        {item.title}
                      </span>

                      {item.description && (
                        <p className='mt-1.5 line-clamp-2 text-sm leading-relaxed text-stone-500'>
                          {item.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      {selectedItem && (
        <DialogShell
          title={selectedItem.title}
          description={selectedItem.description || undefined}
          onClose={() => setSelectedItem(null)}
          canClose={!isDeleting}
          maxWidthClass='max-w-6xl'>
          <button
            type='button'
            onClick={() => setSelectedItem(null)}
            disabled={isDeleting}
            aria-label='Đóng ảnh phóng to'
            className='absolute top-4 right-4 z-10 rounded-full bg-primary/70 p-3 text-surface transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50 sm:top-8 sm:right-8'>
            <X className='size-6' aria-hidden='true' />
          </button>

          <div className='flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row'>
            {/* Image Section */}
            <div className='relative flex min-h-[50vh] flex-1 items-center justify-center bg-black/50 p-4 lg:min-h-0'>
              <Image
                unoptimized
                src={selectedItem.image_url}
                alt={selectedItem.title}
                width={1200}
                height={800}
                className='max-h-[80vh] max-w-full rounded-lg object-contain'
              />
            </div>

            {/* Content Section */}
            <div className='flex max-h-[40vh] w-full flex-col overflow-y-auto bg-white lg:max-h-none lg:w-96'>
              <div className='flex-1 p-6 sm:p-8'>
                <h2 className='mb-4 text-2xl leading-tight font-semibold text-stone-800'>
                  {selectedItem.title}
                </h2>

                {selectedItem.event_date && (
                  <div className='mb-6 flex items-center gap-2 border-b border-stone-100 pb-6 font-medium text-stone-500'>
                    <CalendarDays className='size-4' aria-hidden='true' />
                    <span>
                      {dayjs(selectedItem.event_date).format('DD/MM/YYYY')}
                    </span>
                  </div>
                )}

                {selectedItem.description ? (
                  <div className='prose prose-stone text-stone-600'>
                    <p className='leading-relaxed whitespace-pre-wrap'>
                      {selectedItem.description}
                    </p>
                  </div>
                ) : (
                  <p className='text-stone-400 italic'>
                    Không có nội dung mô tả.
                  </p>
                )}
              </div>

              <div className='flex items-center justify-between border-t border-stone-100 bg-stone-50 p-6 text-sm font-medium text-stone-400'>
                <span>
                  Đã thêm vào{' '}
                  {dayjs(selectedItem.created_at).format('DD/MM/YYYY')}
                </span>

                {isAdmin && (
                  <div className='flex gap-2'>
                    <button
                      onClick={() => {
                        setSelectedItem(null)
                        if (onEdit) onEdit(selectedItem)
                      }}
                      className='rounded-lg bg-stone-100/80 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition-all hover:bg-stone-200 hover:text-stone-900'>
                      Sửa
                    </button>
                    <button
                      onClick={() => handleDelete(selectedItem)}
                      disabled={isDeleting}
                      className='rounded-md bg-red-100 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50'>
                      {isDeleting ? 'Đang xóa...' : 'Xóa'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogShell>
      )}
    </>
  )
}
