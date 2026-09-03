import { MemberListProvider } from '@/context/MemberListContext'
import EventsList from '@/components/EventsList'
import MemberDetailModal from '@/components/modal/MemberDetailModal'
import { fetchAllRows } from '@/utils/supabase/pagination'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export const metadata = {
  title: 'Sự kiện gia phả'
}

export default async function EventsPage() {
  const supabase = await getSupabase()
  const profile = await getProfile()
  const canEdit =
    profile?.is_active === true &&
    (profile.role === 'admin' || profile.role === 'editor')

  const [persons, customEvents] = await Promise.all([
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from('persons')
        .select(
          'id, full_name, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased'
        )
        .order('id', { ascending: true })
        .range(from, to)
      return { data, error }
    }),
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from('custom_events')
        .select('id, version, name, content, event_date, location, created_by')
        .order('id', { ascending: true })
        .range(from, to)
      return { data, error }
    })
  ])

  return (
    <MemberListProvider>
      <div className='relative flex w-full flex-1 flex-col pb-12'>
        <div className='relative z-20 mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8'>
          <h1 className='title'>Sự kiện gia phả</h1>
          <p className='mt-1 text-sm text-stone-500'>
            Sinh nhật, ngày giỗ (âm lịch) và các sự kiện tuỳ chỉnh
          </p>
        </div>

        <main className='mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 lg:px-8'>
          <EventsList
            persons={persons}
            customEvents={customEvents}
            canEdit={canEdit}
          />
        </main>
      </div>

      {/* Modal for member details when clicking an event card */}
      <MemberDetailModal />
    </MemberListProvider>
  )
}
