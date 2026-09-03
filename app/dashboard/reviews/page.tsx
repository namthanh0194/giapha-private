import ChangeRequestList, {
  type ChangeRequestItem
} from '@/components/ChangeRequestList'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Rà soát đóng góp' }

export default async function ReviewsPage() {
  const profile = await getProfile()
  if (!profile?.is_active) redirect('/dashboard')

  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('change_requests')
    .select(
      'id, target_table, target_id, operation, proposed_data, status, requester_id, reviewer_id, review_note, created_at, reviewed_at, withdrawn_at'
    )
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) console.error('Cannot load change requests:', error)
  const requests = (data ?? []) as Omit<ChangeRequestItem, 'current_data'>[]
  const personIds = requests
    .filter(
      (request) =>
        request.target_table === 'persons' && request.operation === 'UPDATE'
    )
    .map((request) => request.target_id)
  const { data: persons } = personIds.length
    ? await supabase
        .from('persons')
        .select(
          'id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, other_names, note'
        )
        .in('id', personIds)
    : { data: [] }
  const personById = new Map(
    (persons ?? []).map((person) => [person.id, person])
  )

  const items: ChangeRequestItem[] = requests.map((request) => ({
    ...request,
    current_data:
      request.target_table === 'persons' && request.operation === 'UPDATE'
        ? (personById.get(request.target_id) ?? null)
        : null
  }))
  const canReview = profile.role === 'admin' || profile.role === 'editor'

  return (
    <main className='mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8'>
      <h1 className='title'>Rà soát đóng góp</h1>
      <p className='mt-1 text-sm text-secondary'>
        Đối chiếu dữ liệu hiện tại với đề xuất trước khi công bố vào gia phả.
      </p>
      <div className='mt-6'>
        <ChangeRequestList
          requests={items}
          currentUserId={profile.id}
          canReview={canReview}
        />
      </div>
    </main>
  )
}
