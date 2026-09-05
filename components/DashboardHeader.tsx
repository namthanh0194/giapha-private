import config from '@/app/config'
import HeaderMenu from '@/components/HeaderMenu'
import { House } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

export default function DashboardHeader() {
  return (
    <header className='sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-xl transition-all duration-200'>
      <div className='mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8'>
        <div className='flex min-w-0 items-center gap-4'>
          <Link
            href='/dashboard'
            className='group flex min-h-11 min-w-0 items-center gap-2 sm:gap-3'>
            <div className='relative size-10 shrink-0 overflow-hidden rounded-xl transition-all'>
              <Image
                src='/icon.png'
                alt='Logo'
                fill
                className='object-contain'
                sizes='40px'
              />
            </div>
            <h1 className='truncate font-serif text-xl font-semibold text-stone-800 transition-colors group-hover:text-amber-700 sm:text-2xl'>
              {config.siteName}
            </h1>
          </Link>
        </div>
        <div className='flex shrink-0 items-center gap-2 sm:gap-4'>
          <Link
            href='/'
            aria-label='Về trang chủ'
            className='inline-flex size-10 items-center justify-center rounded-xl border border-border text-secondary transition-colors hover:bg-neutral hover:text-primary sm:size-auto sm:gap-2 sm:px-4 sm:py-3'>
            <House className='size-4' />
            <span className='hidden sm:inline'>Trang chủ</span>
          </Link>
          <HeaderMenu />
        </div>
      </div>
    </header>
  )
}
