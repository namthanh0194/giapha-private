'use client'

import { GalleryItem } from '@/types'
import { Clock, LayoutGrid, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import GalleryGrid from './GalleryGrid'
import UploadModal from './modal/UploadModal'

export default function GalleryClient({
  initialItems,
  isAdmin
}: {
  initialItems: GalleryItem[]
  isAdmin: boolean
}) {
  const [items, setItems] = useState<GalleryItem[]>(initialItems)
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<GalleryItem | null>(null)
  const router = useRouter()

  const handleUploadSuccess = () => {
    setIsModalOpen(false)
    setEditingItem(null)
    // Refresh the server component to get new data
    router.refresh()
  }

  const handleDeleteSuccess = (deletedId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== deletedId))
    router.refresh()
  }

  const handleEdit = (item: GalleryItem) => {
    setEditingItem(item)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setTimeout(() => setEditingItem(null), 300) // clear after animation
  }

  return (
    <>
      <div className='mb-8 flex flex-col items-stretch justify-between gap-4 sm:mb-12 sm:flex-row sm:items-center'>
        <div className='flex items-center gap-3'>
          <div>
            <h1 className='title'>Phòng trưng bày</h1>
            <p className='mt-2 text-sm text-stone-500 sm:text-sm'>
              Lưu giữ những kỷ niệm và khoảnh khắc đáng nhớ
            </p>
          </div>
        </div>

        <div className='flex items-center gap-3'>
          {/* View switcher */}
          <div className='flex items-center rounded-xl border border-stone-200/60 bg-stone-100 p-1'>
            <button
              onClick={() => setViewMode('grid')}
              className={`flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                viewMode === 'grid'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              title='Chế độ lưới'>
              <LayoutGrid className='size-4' />
              <span className='xs:inline hidden'>Lưới</span>
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                viewMode === 'timeline'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              title='Chế độ dòng thời gian'>
              <Clock className='size-4' />
              <span className='xs:inline hidden'>Dòng thời gian</span>
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsModalOpen(true)}
              className='btn-primary whitespace-nowrap'>
              <Plus className='size-5' />
              <span>Thêm hình ảnh</span>
            </button>
          )}
        </div>
      </div>

      <GalleryGrid
        items={items}
        isAdmin={isAdmin}
        viewMode={viewMode}
        onEdit={handleEdit}
        onDeleteSuccess={handleDeleteSuccess}
      />

      <UploadModal
        key={editingItem?.id || 'new'}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleUploadSuccess}
        initialData={editingItem}
      />
    </>
  )
}
