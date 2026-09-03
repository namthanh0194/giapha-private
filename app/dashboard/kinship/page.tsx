import KinshipFinder from '@/components/KinshipFinder'
import { fetchAllRows } from '@/utils/supabase/pagination'
import { getSupabase } from '@/utils/supabase/queries'

export const metadata = {
  title: 'Tra cứu danh xưng'
}

export default async function KinshipPage() {
  const supabase = await getSupabase()

  const [persons, relationships] = await Promise.all([
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from('persons')
        .select(
          'id, full_name, gender, birth_year, birth_order, generation, is_in_law, avatar_url'
        )
        .order('birth_year', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to)
      return { data, error }
    }),
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from('relationships')
        .select('type, person_a, person_b')
        .order('id', { ascending: true })
        .range(from, to)
      return { data, error }
    })
  ])

  return (
    <div className='relative flex w-full flex-1 flex-col pb-12'>
      <div className='relative z-20 mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8'>
        <h1 className='title'>Tra cứu danh xưng</h1>
        <p className='mt-1 text-sm text-stone-500'>
          Chọn hai thành viên để tự động tính cách gọi theo quan hệ gia phả
        </p>
      </div>

      <main className='mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 lg:px-8'>
        <KinshipFinder persons={persons} relationships={relationships} />
      </main>
    </div>
  )
}
