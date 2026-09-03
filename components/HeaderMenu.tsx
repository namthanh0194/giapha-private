'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart2,
  ChevronDown,
  ClipboardCheck,
  Database,
  ArrowUpCircle,
  GitMerge,
  History,
  Info,
  Network,
  UserCircle,
  Users
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import LogoutButton from './LogoutButton'
import { useUser } from './UserProvider'

export default function HeaderMenu() {
  const { user, isAdmin, isEditor } = useUser()
  const userEmail = user?.email
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className='relative' ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className='flex items-center gap-2 rounded-full border border-transparent py-1.5 pr-4 pl-2 transition-all duration-200 hover:border-stone-200 hover:bg-stone-100'>
        <div className='flex size-8 items-center justify-center rounded-full bg-linear-to-br from-amber-200 to-amber-100 font-medium text-amber-800 shadow-sm ring-1 ring-amber-300/50'>
          {userEmail ? (
            userEmail.charAt(0).toUpperCase()
          ) : (
            <UserCircle className='size-5' />
          )}
        </div>
        <ChevronDown
          className={`size-4 text-stone-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className='absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-3xl border border-border bg-surface py-2'>
            <div className='border-b border-stone-100 bg-stone-50/50 px-4 py-3'>
              <p className='mb-0.5 text-sm font-medium text-stone-400'>
                Tài khoản
              </p>
              <p className='truncate text-sm font-medium text-stone-900'>
                {userEmail}
              </p>
            </div>

            <div className='py-1'>
              <Link
                href='/dashboard'
                onClick={() => setIsOpen(false)}
                className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-amber-50 hover:text-amber-700'>
                <Network className='size-4' />
                Bảng điều khiển
              </Link>

              <Link
                href='/dashboard/members'
                onClick={() => setIsOpen(false)}
                className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-amber-50 hover:text-amber-700'>
                <Network className='size-4' />
                Cây gia phả
              </Link>

              <Link
                href='/dashboard/kinship'
                onClick={() => setIsOpen(false)}
                className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-blue-50 hover:text-blue-700'>
                <GitMerge className='size-4' />
                Tra cứu danh xưng
              </Link>

              <Link
                href='/dashboard/stats'
                onClick={() => setIsOpen(false)}
                className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-purple-50 hover:text-purple-700'>
                <BarChart2 className='size-4' />
                Thống kê
              </Link>

              <Link
                href='/dashboard/activity'
                onClick={() => setIsOpen(false)}
                className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-amber-50 hover:text-amber-700'>
                <History className='size-4' />
                Lịch sử hoạt động
              </Link>

              {isEditor && (
                <Link
                  href='/dashboard/reviews'
                  onClick={() => setIsOpen(false)}
                  className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-amber-50 hover:text-amber-700'>
                  <ClipboardCheck className='size-4' />
                  Rà soát đóng góp
                </Link>
              )}

              {isAdmin && (
                <>
                  <div className='mt-1 px-4 py-2'>
                    <p className='text-sm font-medium text-rose-500'>
                      Quản trị viên
                    </p>
                  </div>

                  <Link
                    href='/dashboard/users'
                    onClick={() => setIsOpen(false)}
                    className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-rose-50 hover:text-rose-700'>
                    <Users className='size-4' />
                    Quản lý người dùng
                  </Link>

                  <Link
                    href='/dashboard/lineage'
                    onClick={() => setIsOpen(false)}
                    className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700'>
                    <Network className='size-4' />
                    Thứ tự gia phả
                  </Link>

                  <Link
                    href='/dashboard/data'
                    onClick={() => setIsOpen(false)}
                    className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-teal-50 hover:text-teal-700'>
                    <Database className='size-4' />
                    Sao lưu & Phục hồi
                  </Link>

                  <Link
                    href='/dashboard/upgrade'
                    onClick={() => setIsOpen(false)}
                    className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-amber-50 hover:text-amber-700'>
                    <ArrowUpCircle className='size-4' />
                    Nâng cấp hệ thống
                  </Link>
                </>
              )}

              <div className='mx-4 my-1 h-px bg-stone-100' />

              <Link
                href='/about'
                onClick={() => setIsOpen(false)}
                className='flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-rose-50 hover:text-rose-700'>
                <Info className='size-4' />
                Giới thiệu
              </Link>

              <LogoutButton />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
