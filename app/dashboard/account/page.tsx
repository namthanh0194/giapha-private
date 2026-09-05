'use client'

import { changeCurrentUserPassword } from '@/app/actions/user'
import { KeyRound } from 'lucide-react'
import { useState, useTransition } from 'react'

export default function AccountPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)

    if (newPassword !== confirmPassword) {
      setIsError(true)
      setMessage('Mật khẩu xác nhận không khớp.')
      return
    }

    startTransition(async () => {
      const result = await changeCurrentUserPassword(
        currentPassword,
        newPassword
      )

      if (result.error) {
        setIsError(true)
        setMessage(result.error)
        return
      }

      setIsError(false)
      setMessage(
        'Đã đổi mật khẩu. Hãy dùng mật khẩu mới cho lần đăng nhập sau.'
      )
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    })
  }

  return (
    <main className='flex w-full flex-1 bg-stone-50/50 pt-8'>
      <div className='mx-auto w-full max-w-2xl px-4 pb-8 sm:px-6 lg:px-8'>
        <section className='overflow-hidden rounded-2xl border border-stone-200/60 bg-white/60 backdrop-blur-xl'>
          <div className='border-b border-stone-100/80 bg-stone-50/50 px-6 py-5'>
            <div className='flex items-center gap-3'>
              <div className='flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-800'>
                <KeyRound className='size-5' />
              </div>
              <div>
                <h1 className='font-serif text-xl font-semibold text-stone-800'>
                  Đổi mật khẩu
                </h1>
                <p className='mt-1 text-sm text-stone-500'>
                  Cập nhật mật khẩu cho chính tài khoản của bạn.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className='space-y-4 p-6'>
            <div>
              <label
                htmlFor='current-password'
                className='mb-1 block text-sm font-medium text-stone-700'>
                Mật khẩu hiện tại
              </label>
              <input
                id='current-password'
                type='password'
                autoComplete='current-password'
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                className='w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
              />
            </div>

            <div>
              <label
                htmlFor='new-password'
                className='mb-1 block text-sm font-medium text-stone-700'>
                Mật khẩu mới
              </label>
              <input
                id='new-password'
                type='password'
                autoComplete='new-password'
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
                placeholder='Ít nhất 8 ký tự'
                className='w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
              />
            </div>

            <div>
              <label
                htmlFor='confirm-password'
                className='mb-1 block text-sm font-medium text-stone-700'>
                Xác nhận mật khẩu mới
              </label>
              <input
                id='confirm-password'
                type='password'
                autoComplete='new-password'
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
                className='w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
              />
            </div>

            {message && (
              <p
                role='status'
                className={`rounded-lg px-3 py-2 text-sm ${
                  isError
                    ? 'bg-red-50 text-red-700'
                    : 'bg-emerald-50 text-emerald-800'
                }`}>
                {message}
              </p>
            )}

            <div className='flex justify-end pt-2'>
              <button
                type='submit'
                disabled={isPending}
                className='btn-primary'>
                {isPending ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
