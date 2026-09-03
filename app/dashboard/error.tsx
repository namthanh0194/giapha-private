'use client'

import Link from 'next/link'

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const errorId = error.digest ?? 'Không có'

  return (
    <div className='flex min-h-[60vh] items-center justify-center p-4 font-sans text-stone-900'>
      <div className='w-full max-w-md rounded-2xl border border-stone-200 bg-white/70 p-6 text-center backdrop-blur-xl'>
        <div className='mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-700'>
          <svg
            className='size-6'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'>
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
            />
          </svg>
        </div>
        <h2 className='font-serif text-xl font-semibold text-stone-900'>
          Không thể tải khu vực quản trị
        </h2>
        <p className='mt-2 text-sm text-stone-600'>
          Đã xảy ra lỗi khi tải dữ liệu bảng điều khiển. Vui lòng thử lại hoặc
          điều hướng đến khu vực khác.
        </p>
        <p className='mt-4 font-mono text-sm text-stone-500'>
          Mã sự cố: {errorId}
        </p>
        <div className='mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center'>
          <button
            type='button'
            onClick={() => reset()}
            className='inline-flex h-10 items-center justify-center rounded-xl bg-stone-900 px-4 text-sm font-medium text-white transition hover:bg-stone-800'>
            Thử lại
          </button>
          <Link
            href='/dashboard'
            className='inline-flex h-10 items-center justify-center rounded-xl border border-stone-200 bg-transparent px-4 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900'>
            Về tổng quan
          </Link>
          <Link
            href='/'
            className='inline-flex h-10 items-center justify-center rounded-xl border border-stone-200 bg-transparent px-4 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900'>
            Trang chủ
          </Link>
        </div>
      </div>
    </div>
  )
}
