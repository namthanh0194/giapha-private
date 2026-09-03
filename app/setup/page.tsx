import Footer from '@/components/Footer'
import { MIGRATION_CATALOG, readMigrationContent } from '@/utils/migrations/catalog'
import { ArrowLeft, Database, Play } from 'lucide-react'
import Link from 'next/link'
import CopyButton from './CopyButton'

export default async function SetupPage() {
  let sqlBundle = ''
  try {
    const migrationContents = await Promise.all(MIGRATION_CATALOG.map((file) => readMigrationContent(file)))

    sqlBundle = [
       '-- GIAPHA-OS: canonical Supabase migration bundle',
      '-- Run this entire script once in Supabase SQL Editor.',
      '',
       ...migrationContents.flatMap((content, index) => [
         '',
         `-- ${MIGRATION_CATALOG[index]}`,
        content
      ])
    ].join('\n')
  } catch (error) {
    console.error('Error reading database SQL bundle:', error)
    sqlBundle =
      '-- Lỗi: Không thể đọc bộ SQL khởi tạo database. Vui lòng kiểm tra lại mã nguồn.'
  }

  return (
    <div className='relative flex min-h-screen flex-col overflow-hidden bg-neutral select-none selection:bg-tertiary/20 selection:text-primary'>
      <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-size-[24px_24px] opacity-30'></div>
      <div className='pointer-events-none absolute inset-x-0 top-0 flex h-screen justify-center overflow-hidden'>
        <div className='absolute top-[-10%] right-[-5%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full bg-tertiary/10 mix-blend-multiply blur-[100px]' />
        <div className='absolute bottom-[0%] left-[-10%] h-[60vw] max-h-[800px] w-[60vw] max-w-[800px] rounded-full bg-secondary/10 mix-blend-multiply blur-[120px]' />
      </div>

      <div className='relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-4 py-12'>
        <div className='relative mb-8 w-full overflow-hidden rounded-3xl border border-stone-200 bg-white p-8 sm:p-10'>
          <div className='mb-6 flex items-center gap-4'>
            <div className='rounded-2xl bg-neutral p-4 text-tertiary'>
              <Database className='size-8' />
            </div>
            <div>
              <h2 className='text-2xl font-semibold text-stone-900 sm:text-3xl'>
                Khởi tạo Cơ sở dữ liệu
              </h2>
              <p className='font-medium text-stone-500'>
                Hệ thống phát hiện database của bạn chưa được thiết lập cấu trúc
                bảng (schema).
              </p>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-8 md:grid-cols-2'>
            <div className='space-y-6'>
              <div className='h-full rounded-2xl border border-stone-200 bg-stone-50 p-6'>
                <h3 className='mb-4 flex items-center gap-2 font-semibold text-stone-900'>
                  <Play className='size-5 text-stone-500' />
                  Hướng dẫn thực hiện:
                </h3>

                <ol className='list-inside list-decimal space-y-4 text-stone-600'>
                  <li className='leading-relaxed'>
                    Bấm nút{' '}
                    <strong className='text-tertiary'>
                      Copy toàn bộ SQL
                    </strong>{' '}
                    ở bên dưới; bundle đã gồm schema và tất cả migration.
                  </li>
                  <li className='leading-relaxed'>
                    Mở{' '}
                    <a
                      href='https://supabase.com/dashboard/project/_/sql/new'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='font-medium text-amber-600 hover:underline'>
                      Supabase SQL Editor
                    </a>{' '}
                    trong dự án của bạn.
                  </li>
                  <li className='leading-relaxed'>
                    <strong>Dán (Paste)</strong> mã vừa copy vào khung soạn thảo
                    của Supabase.
                  </li>
                  <li className='leading-relaxed'>
                    Dán toàn bộ mã vừa copy và bấm nút <strong>RUN</strong> một
                    lần.
                  </li>
                  <li className='leading-relaxed'>
                    Quay lại đây và <strong>Tải lại trang</strong> (hoặc bấm
                    Đăng nhập lại).
                  </li>
                </ol>

                <div className='mt-8'>
                  <CopyButton content={sqlBundle} />
                </div>
              </div>
            </div>

            <div className='col-span-1 flex h-[400px] flex-col overflow-hidden rounded-2xl bg-primary'>
              <div className='flex items-center justify-between border-b border-secondary bg-primary px-4 py-2'>
                <span className='font-mono text-sm text-border'>
                  SQL bundle (schema + migrations)
                </span>
              </div>
              <div className='custom-scrollbar w-full flex-grow overflow-y-auto p-4'>
                <pre className='font-mono text-sm leading-relaxed whitespace-pre text-neutral sm:text-sm'>
                  <code>{sqlBundle}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Link
        href='/login'
        className='absolute top-6 left-6 z-20 flex items-center gap-2 rounded-full border border-stone-200 bg-white/60 px-5 py-2.5 text-sm font-medium text-stone-500 transition-all duration-300 hover:border-stone-300 hover:text-stone-900'>
        <ArrowLeft className='size-4' />
        Quay lại Đăng nhập
      </Link>

      <Footer className='relative z-10 mt-auto border-none bg-transparent' />
    </div>
  )
}
