import MemberForm from '@/components/MemberForm'
import { getProfile } from '@/utils/supabase/queries'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default async function NewMemberPage() {
  const profile = await getProfile()

  const isAdmin = profile?.role === 'admin' && profile.is_active
  const canEdit =
    profile?.is_active === true &&
    (profile.role === 'admin' || profile.role === 'editor')

  // If user cannot edit, reject access
  if (!canEdit) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-stone-50'>
        <div className='text-center'>
          <h1 className='text-2xl font-semibold text-stone-800'>
            Truy cập bị từ chối
          </h1>
          <p className='mt-2 text-stone-600'>
            Bạn không có quyền thêm thành viên.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex w-full flex-1 flex-col pb-8'>
      {/* Decorative background blurs */}
      {/* <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-100/40 rounded-full blur-[100px] pointer-events-none" /> */}
      {/* <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-stone-200/40 rounded-full blur-[100px] pointer-events-none" /> */}

      <div className='relative z-20 mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8'>
        <div className='flex items-center gap-3'>
          <Link
            href='/dashboard/members'
            className='-ml-2 flex min-h-11 min-w-11 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600'
            title='Quay lại danh sách'>
            <ArrowLeft className='size-5' />
          </Link>
          <h1 className='title'>Thêm thành viên mới</h1>
        </div>
        <Link
          href='/dashboard/members'
          className='inline-flex min-h-11 items-center rounded-lg bg-stone-100/80 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition-all hover:bg-stone-200 hover:text-stone-900'>
          Hủy
        </Link>
      </div>

      <main className='relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-8'>
        <MemberForm isAdmin={isAdmin} canEdit={canEdit} />
      </main>
    </div>
  )
}
