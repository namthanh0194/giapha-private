import Footer from '@/components/Footer'
import HeaderMenu from '@/components/HeaderMenu'
import HomepageFamilyTree from '@/components/HomepageFamilyTree'
import { UserProvider } from '@/components/UserProvider'
import {
  getHomepageFamilyTree,
  getProfile,
  getPublicHomepageSummary,
  getUser
} from '@/utils/supabase/queries'
import type {
  PublicHomepageBranch,
  PublicHomepageEvent
} from '@/utils/public-homepage'
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Crown,
  GitBranch,
  MapPin,
  Network,
  ShieldCheck,
  Sprout,
  Users
} from 'lucide-react'
import Link from 'next/link'
import config from './config'

const ButtonLink = ({
  href,
  children,
  outline = false
}: {
  href: string
  children: React.ReactNode
  outline?: boolean
}) => (
  <Link href={href} className={outline ? 'btn-outline' : 'btn-primary'}>
    {children}
  </Link>
)

export default async function HomePage() {
  const summary = await getPublicHomepageSummary()
  const user = await getUser()
  const profile = user ? await getProfile(user.id) : null
  const familyTree = await getHomepageFamilyTree()
  const isLoggedIn = Boolean(user)
  const memberHref = isLoggedIn ? '/dashboard/members?view=tree' : '/login'
  const memberLabel = 'Đăng nhập/Đăng ký'

  const stats = [
    [String(summary.totalMembers), 'Thành viên', Users],
    [String(summary.totalGenerations), 'Thế hệ', Network],
    [String(summary.totalBranches), 'Chi họ', GitBranch],
    ['—', 'Tỉnh thành', MapPin]
  ] as const

  return (
    <div className='min-h-screen bg-neutral text-primary'>
      <header className='relative z-50 border-b border-border bg-white/90 backdrop-blur-xl'>
        <div className='mx-auto flex h-18 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-8'>
          <Link
            href='/'
            className='flex items-center gap-3'
            aria-label={config.siteName}>
            <span className='flex size-10 items-center justify-center rounded-full bg-amber-100 text-tertiary'>
              <Crown className='size-5' />
            </span>
            <span className='font-serif text-lg font-semibold'>
              {config.siteName}
            </span>
          </Link>
          <nav
            className='hidden items-center gap-6 md:flex'
            aria-label='Điều hướng chính'>
            <a
              href='#gioi-thieu'
              className='text-sm text-secondary hover:text-primary'>
              Giới thiệu
            </a>
            <a
              href='#pha-he'
              className='text-sm text-secondary hover:text-primary'>
              Phả hệ
            </a>
            <a
              href='#su-kien'
              className='text-sm text-secondary hover:text-primary'>
              Sự kiện
            </a>
          </nav>
          {isLoggedIn ? (
            <UserProvider user={user} profile={profile}>
              <HeaderMenu />
            </UserProvider>
          ) : (
            <ButtonLink href={memberHref}>
              <span className='sm:hidden'>Đăng nhập</span>
              <span className='hidden sm:inline'>{memberLabel}</span>
            </ButtonLink>
          )}
        </div>
      </header>

      <main>
        <section className='relative isolate overflow-hidden'>
          <div className='absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_0%,#fef3c7,transparent_42%)]' />
          <div className='mx-auto grid max-w-[1280px] gap-12 px-4 py-18 sm:px-6 md:py-24 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:px-8'>
            <div className='max-w-2xl'>
              <p className='mb-5 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800'>
                <Sprout className='size-4' />
                Nối liền cội nguồn qua nhiều thế hệ
              </p>
              <h1 className='font-serif text-4xl leading-tight font-semibold sm:text-5xl lg:text-6xl'>
                {config.siteName}
              </h1>
              <p className='mt-5 max-w-xl text-sm leading-6 text-secondary'>
                Lưu giữ cội nguồn, kết nối con cháu muôn phương. Cùng gìn giữ ký
                ức, truyền thống và những câu chuyện của gia tộc cho thế hệ mai
                sau.
              </p>
              <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
                <ButtonLink href={memberHref}>
                  Khám phá cây gia phả <ArrowRight className='size-4' />
                </ButtonLink>
                <a href='#gioi-thieu' className='btn-outline'>
                  Tìm hiểu dòng họ
                </a>
              </div>
            </div>
            <div className='relative mx-auto w-full max-w-lg rounded-3xl bg-primary p-6 text-white shadow-soft sm:p-8'>
              <div className='absolute inset-0 overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_100%_0%,#d9770666,transparent_34%)]' />
              <div className='relative'>
                <div className='mb-8 flex items-center justify-between'>
                  <div>
                    <p className='text-sm text-stone-300'>Cây gia phả</p>
                    <p className='mt-1 font-serif text-xl font-semibold'>
                      Nguyễn Đăng Tộc
                    </p>
                  </div>
                  <Network className='size-5 text-amber-300' />
                </div>
                <div className='grid grid-cols-2 gap-3'>
                  <div className='col-span-2 mx-auto w-full max-w-[220px] rounded-xl bg-amber-100 p-3 text-center text-primary'>
                    <p className='text-sm font-medium'>Thủy tổ</p>
                    <p className='mt-1 text-sm text-secondary'>
                      {summary.ancestorName}
                    </p>
                  </div>
                  {summary.branches.map((branch: PublicHomepageBranch, index) => (
                    <div
                      key={branch.name}
                      className={`rounded-xl bg-white/10 p-3 ${
                        summary.branches.length % 2 === 1 &&
                        index === summary.branches.length - 1
                          ? 'col-span-2'
                          : ''
                      }`}>
                      <div className='mb-4 h-px w-5 bg-amber-300/70' />
                      <p className='text-sm font-medium'>{branch.name}</p>
                      <p className='mt-1 text-sm text-stone-300'>
                        {branch.members} thành viên
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id='gioi-thieu' className='bg-white py-16 md:py-24'>
          <div className='mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8'>
            <div className='grid gap-10 lg:grid-cols-[0.85fr_1.15fr]'>
              <div>
                <p className='text-sm font-medium text-tertiary'>
                  Cội nguồn dòng họ
                </p>
                <h2 className='mt-3 font-serif text-3xl font-semibold'>
                  Giới thiệu dòng họ
                </h2>
              </div>
              <div>
                <p className='text-sm leading-7 text-secondary'>
                  Nguyễn Đăng Tộc được gây dựng từ vùng đất tổ tiên, qua chín
                  đời bồi đắp nề nếp hiếu học, nghĩa tình và đoàn kết. Gia phả
                  là nơi ghi lại hành trình của từng thế hệ, để mỗi người con
                  hiểu hơn về nguồn cội của mình.
                </p>
                <div className='mt-6 flex items-start gap-3 rounded-xl bg-neutral p-5'>
                  <Crown className='size-5 text-tertiary' />
                  <div>
                    <p className='text-sm font-medium'>Vị thủy tổ</p>
                    <p className='mt-1 text-sm leading-6 text-secondary'>
                      Cụ {summary.ancestorName} là người khai lập dòng họ theo
                      tư liệu đang được lưu giữ.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className='mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4'>
              {stats.map(([value, label, Icon]) => (
                <div key={label} className='rounded-xl bg-neutral p-5'>
                  <Icon className='size-5 text-tertiary' />
                  <p className='mt-5 font-serif text-3xl font-semibold'>
                    {value}
                  </p>
                  <p className='mt-1 text-sm text-secondary'>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id='pha-he' className='py-16 md:py-24'>
          <div className='mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8'>
            <p className='text-sm font-medium text-tertiary'>
              Khám phá trực quan
            </p>
            <h2 className='mt-3 font-serif text-3xl font-semibold'>
              Sơ đồ phả hệ
            </h2>
            <p className='mt-3 max-w-2xl text-sm leading-6 text-secondary'>
              Theo dõi mối liên kết giữa các thế hệ trên cây gia phả trực quan,
              dễ tra cứu.
            </p>
          </div>
          <div className='mt-8 w-full px-2 sm:px-4 lg:px-8'>
            {familyTree ? (
              <HomepageFamilyTree data={familyTree} />
            ) : (
              <div className='mx-auto max-w-[1280px]'>
                <div className='rounded-3xl bg-primary p-8 text-center text-white md:p-12'>
                  <Network className='mx-auto size-7 text-amber-300' />
                  <p className='mt-5 text-sm leading-6 text-stone-300'>
                    Đăng nhập để xem sơ đồ cây gia phả theo dữ liệu được cấp quyền.
                  </p>
                  <ButtonLink href={memberHref}>
                    Xem sơ đồ phả hệ <ArrowRight className='size-4' />
                  </ButtonLink>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className='bg-white py-16 md:py-24'>
          <div className='mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8'>
            <div className='flex items-end justify-between gap-5'>
              <div>
                <p className='text-sm font-medium text-tertiary'>
                  Các nhánh chính
                </p>
                <h2 className='mt-3 font-serif text-3xl font-semibold'>
                  Các chi họ chính
                </h2>
              </div>
              <Link
                href={memberHref}
                className='hidden items-center gap-1 text-sm font-medium text-secondary hover:text-primary sm:flex'>
                Xem toàn bộ phả hệ <ChevronRight className='size-4' />
              </Link>
            </div>
            <div className='mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              {summary.branches.map((branch: PublicHomepageBranch) => (
                <Link
                  key={branch.name}
                  href={memberHref}
                  className='rounded-xl border border-border bg-white p-5 transition-colors hover:bg-neutral'>
                  <GitBranch className='size-5 text-tertiary' />
                  <h3 className='mt-5 font-serif text-xl font-semibold'>
                    {branch.name}
                  </h3>
                  <p className='mt-2 text-sm leading-6 text-secondary'>
                    {branch.description}
                  </p>
                  <p className='mt-5 text-sm font-medium'>
                    {branch.members} thành viên
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id='su-kien' className='py-16 md:py-24'>
          <div className='mx-auto grid max-w-[1280px] gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8'>
            <div>
              <p className='text-sm font-medium text-tertiary'>
                Gắn kết cộng đồng
              </p>
              <h2 className='mt-3 font-serif text-3xl font-semibold'>
                Sự kiện sắp tới
              </h2>
              <p className='mt-3 text-sm leading-6 text-secondary'>
                Theo dõi lịch giỗ tổ, họp mặt và những hoạt động chung của dòng
                họ.
              </p>
              <ButtonLink href={memberHref} outline>
                <CalendarDays className='size-4' />
                Xem lịch đầy đủ
              </ButtonLink>
            </div>
            <div className='divide-y divide-border rounded-xl border border-border bg-white'>
              {summary.events.length > 0 ? (
                summary.events.map((event: PublicHomepageEvent) => (
                  <div
                    key={`${event.title}-${event.date}`}
                    className='flex items-center gap-4 p-5'>
                    <div className='w-14 rounded-xl bg-amber-100 py-2 text-center'>
                      <p className='font-serif text-2xl font-semibold'>
                        {event.date}
                      </p>
                      <p className='text-sm text-amber-800'>{event.month}</p>
                    </div>
                    <div>
                      <p className='text-sm font-medium'>{event.title}</p>
                      <p className='mt-1 text-sm text-secondary'>
                        {event.detail}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className='p-6 text-sm text-secondary'>
                  Chưa có sự kiện công khai sắp diễn ra. Thành viên có thể đăng
                  nhập để xem toàn bộ lịch dòng họ.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className='bg-primary py-16 text-white md:py-24'>
          <div className='mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8'>
            <p className='text-sm font-medium text-amber-300'>
              Dành cho thành viên
            </p>
            <h2 className='mt-3 font-serif text-3xl font-semibold'>
              Cách tham gia
            </h2>
            <p className='mt-3 max-w-2xl text-sm leading-6 text-stone-300'>
              Dữ liệu dòng họ được phân quyền, chỉ hiển thị cho người dùng đã
              được xác minh.
            </p>
            <div className='mt-8 grid gap-4 md:grid-cols-3'>
              {[
                [
                  '01',
                  'Đăng ký tài khoản',
                  'Cung cấp thông tin để xác minh quan hệ với dòng họ.'
                ],
                [
                  '02',
                  'Chờ quản trị viên duyệt',
                  'Quản trị viên đối chiếu thông tin trước khi cấp quyền.'
                ],
                [
                  '03',
                  'Truy cập gia phả',
                  'Xem và bổ sung thông tin trong phạm vi được cấp.'
                ]
              ].map(([number, title, description]) => (
                <div key={number} className='rounded-xl bg-white/10 p-6'>
                  <p className='font-serif text-3xl font-semibold text-amber-300'>
                    {number}
                  </p>
                  <h3 className='mt-6 text-sm font-medium'>{title}</h3>
                  <p className='mt-2 text-sm leading-6 text-stone-300'>
                    {description}
                  </p>
                </div>
              ))}
            </div>
            <div className='mt-8 flex items-start gap-3 rounded-xl bg-white/10 p-5'>
              <ShieldCheck className='size-5 text-amber-300' />
              <p className='text-sm leading-6 text-stone-200'>
                Thông tin riêng tư được bảo vệ theo vai trò; chỉ người được cấp
                quyền mới xem dữ liệu chi tiết.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}

