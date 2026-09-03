import DuplicateReview from '@/components/DuplicateReview'
import { getDuplicateCandidates } from '@/app/actions/duplicates'

interface DuplicatePageProps { searchParams: Promise<{ page?: string }> }

export const metadata = { title: 'Rà soát hồ sơ trùng lặp' }

export default async function DuplicatePage({ searchParams }: DuplicatePageProps) {
  const { page: pageParam } = await searchParams
  const page = Number.isInteger(Number(pageParam)) && Number(pageParam) > 0 ? Number(pageParam) : 1
  const { candidates, error } = await getDuplicateCandidates(page)

  return (
    <main className='mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8'>
      <h1 className='title'>Rà soát hồ sơ trùng lặp</h1>
      <p className='mt-1 text-sm text-stone-500'>Mỗi lần hợp nhất đều cần xác nhận thủ công từng trường khác biệt.</p>
      {error ? <p role='alert' className='mt-6 text-sm text-error'>{error}</p> : <DuplicateReview candidates={candidates} />}
    </main>
  )
}
