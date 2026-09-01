'use client'

import { motion } from 'framer-motion'
import { ArrowLeft, Info, Mail, ShieldAlert } from 'lucide-react'
import Link from 'next/link'

export default function AboutPage() {
  return (
    <div className='relative flex min-h-screen flex-col bg-neutral selection:bg-amber-200 selection:text-amber-900'>
      <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-size-[24px_24px]'></div>

      <Link href='/dashboard' className='btn absolute top-6 left-6 z-20'>
        <ArrowLeft className='size-4 transition-transform group-hover:-translate-x-1' />
        Quay lại
      </Link>

      <div className='relative z-10 mb-10 flex w-full flex-1 flex-col items-center justify-center px-4 py-20'>
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className='w-full max-w-3xl'>
          <div className='mt-6 mb-8 rounded-3xl border border-stone-200 bg-white p-8 sm:p-12'>
            <div className='mb-6 flex items-center gap-3'>
              <div className='rounded-2xl bg-amber-100/50 p-3 text-amber-700'>
                <Info className='size-6' />
              </div>
              <h1 className='title'>Giới thiệu dự án</h1>
            </div>

            <div className='max-w-none'>
              <p className='mb-8 text-sm leading-relaxed text-stone-600'>
                <strong className='text-stone-800'>Gia Phả ABC</strong> là một
                giải pháp mã nguồn mở được thiết kế giúp các dòng họ, gia đình
                tự xây dựng và quản lý cây phả hệ của riêng mình. Dự án giúp bảo
                tồn và truyền đạt lại thông tin cội nguồn một cách trực quan,
                hiện đại, và đặc biệt là an toàn.
              </p>

              <div className='mt-8 mb-4 flex items-center gap-3 border-t border-stone-100 pt-8'>
                <div className='rounded-xl bg-rose-50 p-2.5 text-rose-600'>
                  <ShieldAlert className='size-5' />
                </div>
                <h2 className='text-xl font-semibold text-stone-900'>
                  Tuyên bố từ chối trách nhiệm & Quyền riêng tư
                </h2>
              </div>

              <div className='rounded-2xl border border-stone-200/60 bg-stone-50 p-6 text-sm leading-relaxed'>
                <p className='mb-4 inline-block rounded-lg border border-stone-200 bg-white px-3 py-2 font-medium text-stone-800'>
                  Dự án này chỉ cung cấp mã nguồn (source code). Không có bất kỳ
                  dữ liệu cá nhân nào được thu thập hay lưu trữ bởi tác giả.
                </p>

                <ul className='list-disc space-y-4 pl-5 text-stone-600'>
                  <li>
                    <strong className='text-stone-800'>
                      Tự lưu trữ hoàn toàn (Self-hosted):
                    </strong>{' '}
                    Khi bạn triển khai ứng dụng, toàn bộ dữ liệu gia phả (tên,
                    ngày sinh, quan hệ, thông tin liên hệ...) được lưu trữ{' '}
                    <strong className='text-stone-800'>
                      trong tài khoản Supabase của chính bạn
                    </strong>
                    . Tác giả dự án không có quyền truy cập vào database đó.
                  </li>
                  <li>
                    <strong className='text-stone-800'>
                      Không thu thập dữ liệu:
                    </strong>{' '}
                    Không có analytics, không có tracking, không có telemetry,
                    không có bất kỳ hình thức thu thập thông tin người dùng nào
                    được tích hợp trong mã nguồn.
                  </li>
                  <li>
                    <strong className='text-stone-800'>
                      Bạn kiểm soát dữ liệu của bạn:
                    </strong>{' '}
                    Mọi dữ liệu gia đình, thông tin thành viên đều nằm hoàn toàn
                    trong cơ sở dữ liệu Supabase mà bạn tạo và quản lý. Bạn có
                    thể xóa, xuất hoặc di chuyển dữ liệu bất cứ lúc nào.
                  </li>
                  <li>
                    <strong className='text-stone-800'>Demo công khai:</strong>{' '}
                    Trang demo tại{' '}
                    <code className='rounded border border-stone-200 bg-white px-1 py-0.5 text-sm text-amber-700'>
                      giapha-os.homielab.com
                    </code>{' '}
                    sử dụng dữ liệu mẫu hư cấu, không chứa thông tin của người
                    thật. Không nên nhập thông tin cá nhân thật vào trang demo.
                  </li>
                </ul>
              </div>

              <div className='mt-8 mb-4 flex items-center gap-3 border-t border-stone-100 pt-8'>
                <div className='rounded-xl bg-blue-50 p-2.5 text-blue-600'>
                  <Mail className='size-5' />
                </div>
                <h2 className='text-xl font-semibold text-stone-900'>
                  Liên hệ & Góp ý
                </h2>
              </div>

              <p className='mb-8 text-sm leading-relaxed text-stone-600'>
                Nếu bạn có bất kỳ thắc mắc, đề xuất tính năng, báo lỗi khi sử
                dụng phần mềm, hoặc muốn thảo luận thì xin vui lòng gửi email về
                địa chỉ:{` `}
                <a
                  href='mailto:giaphaos@homielab.com'
                  className='mt-2 inline-flex items-center gap-1.5 font-medium text-amber-700 transition-colors hover:text-amber-600'>
                  giaphaos@homielab.com
                </a>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
