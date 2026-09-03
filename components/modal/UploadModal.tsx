'use client'

import { saveGalleryItemAction } from '@/app/actions/gallery'
import { Loader2, UploadCloud, X } from 'lucide-react'
import { useRef, useState } from 'react'

import type { GalleryItem } from '@/types'
import Image from 'next/image'

import DialogShell from './DialogShell'

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  initialData?: GalleryItem | null
}

export default function UploadModal({
  isOpen,
  onClose,
  onSuccess,
  initialData
}: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      if (selected.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB')
        return
      }
      setFile(selected)
      const url = URL.createObjectURL(selected)
      setPreview(url)
      setError(null)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files?.[0]
    if (dropped && dropped.type.startsWith('image/')) {
      setFile(dropped)
      setPreview(URL.createObjectURL(dropped))
      setError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!initialData && !file) {
      setError('Vui lòng chọn ảnh.')
      return
    }
    if (!title) {
      setError('Vui lòng nhập tiêu đề.')
      return
    }

    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      if (initialData) {
        formData.set('id', initialData.id)
        formData.set('expected_version', String(initialData.version))
      }
      formData.set('title', title)
      formData.set('description', description)
      formData.set('event_date', eventDate)
      if (file) formData.set('file', file)

      const result = await saveGalleryItemAction(formData)
      if (!result.success) {
        setError(
          result.errorId
            ? result.error + ' Mã sự cố: ' + result.errorId
            : result.error || 'Đã xảy ra lỗi.'
        )
        return
      }

      resetForm()
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi.')
    } finally {
      setIsUploading(false)
    }
  }

  const resetForm = () => {
    setFile(null)
    setPreview(null)
    setTitle('')
    setDescription('')
    setEventDate('')
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const inputClasses =
    'bg-white text-stone-900 placeholder-stone-500 block w-full rounded-xl border border-stone-300  focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:bg-white text-sm px-4 py-3 transition-all outline-none!'

  return isOpen ? (
    <DialogShell
      title={initialData ? 'Chỉnh sửa hình ảnh' : 'Thêm hình ảnh'}
      onClose={handleClose}
      canClose={!isUploading}
      maxWidthClass='max-w-2xl'>
            {/* Sticky Header Actions */}
            <div className='absolute top-4 right-4 z-20 flex items-center gap-2 sm:top-5 sm:right-5'>
              <button
                onClick={handleClose}
                disabled={isUploading}
                aria-label='Đóng hộp thoại tải ảnh'
                className='flex size-11 items-center justify-center rounded-full border border-stone-200/50 bg-stone-100/80 text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50'>
                <X className='size-5' aria-hidden='true' />
              </button>
            </div>

            <div className='custom-scrollbar flex-1 overflow-y-auto px-4 pt-16 pb-8 sm:px-8'>
              <h2 className='mb-6 font-serif text-xl font-semibold text-stone-800'>
                {initialData
                  ? 'Chỉnh sửa hình ảnh'
                  : 'Thêm vào Phòng trưng bày'}
              </h2>

              <form
                id='upload-form'
                onSubmit={handleSubmit}
                className='space-y-6'>
                {/* Image Upload Area */}
                <div
                  className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${preview ? 'border-stone-200 bg-stone-50' : 'border-stone-300 hover:border-pink-400 hover:bg-pink-50/50'}`}
                  onClick={() => !preview && fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}>
                  {preview ? (
                    <div className='relative inline-block w-full'>
                      <Image
                        unoptimized
                        src={preview}
                        alt='Preview'
                        width={800}
                        height={600}
                        className='mx-auto max-h-64 rounded-lg object-contain shadow-sm'
                      />
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation()
                          setFile(null)
                          setPreview(null)
                        }}
                        className='absolute top-2 right-2 rounded-full bg-white/90 p-1.5 text-stone-700 shadow-md backdrop-blur-sm hover:text-rose-600'>
                        <X className='size-4' aria-hidden='true' />
                      </button>
                    </div>
                  ) : (
                    <div className='flex flex-col items-center justify-center space-y-3'>
                      <div className='rounded-full bg-stone-100 p-4 text-stone-400'>
                        <UploadCloud className='size-8' />
                      </div>
                      <div>
                        <p className='text-sm font-medium text-stone-700'>
                          Kéo thả ảnh vào đây, hoặc click để chọn
                        </p>
                        <p className='mt-1 text-sm text-stone-500'>
                          Hỗ trợ JPG, PNG, WEBP (Max 10MB)
                        </p>
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='image/*'
                    className='hidden'
                    onChange={handleFileChange}
                  />
                </div>

                {error && (
                  <div className='rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-600'>
                    {error}
                  </div>
                )}

                {/* Fields */}
                <div className='space-y-4'>
                  <div>
                    <label className='mb-1.5 block text-sm font-medium text-stone-700'>
                      Tiêu đề ảnh / Sự kiện{' '}
                      <span className='text-red-500'>*</span>
                    </label>
                    <input
                      type='text'
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className={inputClasses}
                      placeholder='Ví dụ: Lễ mừng thọ ông nội'
                    />
                  </div>

                  <div>
                    <label className='mb-1.5 block text-sm font-medium text-stone-700'>
                      Ngày diễn ra
                    </label>
                    <input
                      type='date'
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className={inputClasses}
                    />
                  </div>

                  <div>
                    <label className='mb-1.5 block text-sm font-medium text-stone-700'>
                      Nội dung kỷ niệm
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className={`${inputClasses} resize-none`}
                      placeholder='Kể lại câu chuyện đằng sau bức ảnh...'
                    />
                  </div>
                </div>

                <div className='flex justify-end gap-3 border-t border-stone-100 pt-4'>
                  <button
                    type='button'
                    onClick={handleClose}
                    disabled={isUploading}
                    className='btn'>
                    Hủy bỏ
                  </button>
                  <button
                    type='submit'
                    form='upload-form'
                    disabled={isUploading || (!initialData && !file) || !title}
                    className='btn-primary flex items-center gap-2'>
                    {isUploading ? (
                      <>
                        <Loader2 className='size-4 animate-spin' />
                        Đang lưu...
                      </>
                    ) : initialData ? (
                      'Lưu thay đổi'
                    ) : (
                      'Lưu hình ảnh'
                    )}
                  </button>
                </div>
              </form>
            </div>
    </DialogShell>
  ) : null
}
