import ActivityHistory from '@/components/ActivityHistory'
import type { AuditLogEntry, AuditOperation, AuditTableName } from '@/types'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { redirect } from 'next/navigation'

const AUDIT_TABLES = new Set<AuditTableName>([
  'persons',
  'relationships',
  'custom_events',
  'gallery_items',
  'profiles',
  'person_details_private'
])
const AUDIT_OPERATIONS = new Set<AuditOperation>([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE'
])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PAGE_SIZE = 50

interface ActivityPageProps {
  searchParams: Promise<{
    page?: string
    date?: string
    actor?: string
    operation?: string
    table?: string
  }>
}

export const metadata = { title: 'Lịch sử hoạt động' }

export default async function ActivityPage({
  searchParams
}: ActivityPageProps) {
  const params = await searchParams
  const profile = await getProfile()

  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    redirect('/dashboard')
  }

  const supabase = await getSupabase()
  const parsedPage = Number(params.page ?? '1')
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const date = DATE_PATTERN.test(params.date ?? '') ? (params.date ?? '') : ''
  const actor = UUID_PATTERN.test(params.actor ?? '')
    ? (params.actor ?? '')
    : ''
  const operation = AUDIT_OPERATIONS.has(params.operation as AuditOperation)
    ? (params.operation as AuditOperation)
    : ''
  const table = AUDIT_TABLES.has(params.table as AuditTableName)
    ? (params.table as AuditTableName)
    : ''
  const from = (page - 1) * PAGE_SIZE

  let query = supabase
    .from('audit_log')
    .select(
      'id, occurred_at, table_name, record_id, operation, actor_user_id, old_data, new_data',
      { count: 'exact' }
    )
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })

  if (date) {
    const nextDate = new Date(date + 'T00:00:00.000Z')
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    query = query
      .gte('occurred_at', date + 'T00:00:00.000Z')
      .lt('occurred_at', nextDate.toISOString())
  }
  if (actor) query = query.eq('actor_user_id', actor)
  if (operation) query = query.eq('operation', operation)
  if (table) query = query.eq('table_name', table)

  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const entries = (data ?? []) as AuditLogEntry[]
  const { data: undoEntries } = entries.length
    ? await supabase
        .from('audit_log')
        .select('undone_audit_id')
        .in(
          'undone_audit_id',
          entries.map((entry) => entry.id)
        )
    : { data: [] }
  const undoneAuditIds = new Set(
    (undoEntries ?? []).map((entry) => entry.undone_audit_id)
  )

  return (
    <div className='relative flex w-full flex-1 flex-col pb-12'>
      <div className='relative z-20 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8'>
        <h1 className='title'>Lịch sử hoạt động</h1>
        <p className='mt-1 text-sm text-stone-500'>
          Theo dõi thay đổi dữ liệu gia phả theo thời gian.
        </p>
      </div>
      <main className='mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 lg:px-8'>
        <ActivityHistory
          entries={entries.map((entry) => ({
            ...entry,
            is_undone: undoneAuditIds.has(entry.id)
          }))}
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
          filters={{ date, actor, operation, table }}
          isAdmin={profile?.role === 'admin' && profile.is_active}
          canUndo={
            profile?.is_active === true &&
            (profile.role === 'admin' || profile.role === 'editor')
          }
        />
      </main>
    </div>
  )
}
