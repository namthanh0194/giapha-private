import { MemberListProvider } from '@/context/MemberListContext'
import MembersViews from '@/components/MembersViews'
import MemberDetailModal from '@/components/modal/MemberDetailModal'
import ViewToggle from '@/components/ViewToggle'
import type { Person, Relationship } from '@/types'
import { fetchFamilySubtree } from '@/utils/supabase/family-graph'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

import { ViewMode } from '@/components/ViewToggle'

const ALLOWED_FILTERS = new Set([
  'all',
  'male',
  'female',
  'in_law_female',
  'in_law_male',
  'deceased',
  'first_child'
])

const ALLOWED_SORTS = new Set([
  'birth_asc',
  'birth_desc',
  'name_asc',
  'name_desc',
  'updated_desc',
  'updated_asc',
  'generation_asc',
  'generation_desc'
])

const PERSON_FIELDS =
  'id, full_name, gender, birth_year, death_year, death_lunar_year, avatar_url, updated_at, is_deceased, is_in_law, birth_order, generation'

interface PageProps {
  searchParams: Promise<{
    view?: string
    rootId?: string
    avatar?: string
    page?: string
    query?: string
    filter?: string
    sort?: string
  }>
}
export default async function FamilyTreePage({ searchParams }: PageProps) {
  const {
    view,
    rootId,
    avatar,
    page: rawPage,
    query: rawQuery,
    filter: rawFilter,
    sort: rawSort
  } = await searchParams
  const initialView = view as ViewMode | undefined
  const initialShowAvatar = avatar !== 'hide'

  const profile = await getProfile()
  const canEdit =
    profile?.is_active === true &&
    (profile.role === 'admin' || profile.role === 'editor')

  const supabase = await getSupabase()
  const parsedPage = Number(rawPage ?? '1')
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const pageSize = 50
  const query = (rawQuery ?? '').trim().slice(0, 100)
  const filter = ALLOWED_FILTERS.has(rawFilter ?? '')
    ? (rawFilter as string)
    : 'all'
  const sort = ALLOWED_SORTS.has(rawSort ?? '')
    ? (rawSort as string)
    : 'generation_asc'

  let listPersons: Person[] = []
  let listTotal = 0

  let targetRootId = rootId
  if (!targetRootId) {
    const { data: firstPerson } = await supabase
      .from('persons')
      .select('id')
      .order('generation', { ascending: true, nullsFirst: false })
      .order('birth_year', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()
    targetRootId = firstPerson?.id
  }

  const treeData = targetRootId
    ? await fetchFamilySubtree(supabase, {
        rootId: targetRootId,
        maxDepth: 3,
        includeSpouses: true
      })
    : { persons: [], relationships: [], truncated: false, maxDepth: 1 }

  const treePersons: Person[] = treeData.persons
  const relationships: Relationship[] = treeData.relationships

  {
    let queryBuilder = supabase
      .from('persons')
      .select(PERSON_FIELDS, { count: 'exact' })

    if (query) {
      queryBuilder = queryBuilder.ilike('full_name', `%${query}%`)
    }

    switch (filter) {
      case 'male':
        queryBuilder = queryBuilder.eq('gender', 'male')
        break
      case 'female':
        queryBuilder = queryBuilder.eq('gender', 'female')
        break
      case 'in_law_female':
        queryBuilder = queryBuilder.eq('gender', 'female').eq('is_in_law', true)
        break
      case 'in_law_male':
        queryBuilder = queryBuilder.eq('gender', 'male').eq('is_in_law', true)
        break
      case 'deceased':
        queryBuilder = queryBuilder.eq('is_deceased', true)
        break
      case 'first_child':
        queryBuilder = queryBuilder.eq('birth_order', 1)
        break
      case 'all':
      default:
        break
    }

    switch (sort) {
      case 'birth_asc':
        queryBuilder = queryBuilder.order('birth_year', {
          ascending: true,
          nullsFirst: false
        })
        break
      case 'birth_desc':
        queryBuilder = queryBuilder.order('birth_year', {
          ascending: false,
          nullsFirst: false
        })
        break
      case 'name_asc':
        queryBuilder = queryBuilder.order('full_name', { ascending: true })
        break
      case 'name_desc':
        queryBuilder = queryBuilder.order('full_name', { ascending: false })
        break
      case 'updated_asc':
        queryBuilder = queryBuilder.order('updated_at', { ascending: true })
        break
      case 'updated_desc':
        queryBuilder = queryBuilder.order('updated_at', { ascending: false })
        break
      case 'generation_desc':
        queryBuilder = queryBuilder
          .order('generation', { ascending: false, nullsFirst: false })
          .order('birth_order', { ascending: true, nullsFirst: false })
          .order('birth_year', { ascending: true, nullsFirst: false })
        break
      case 'generation_asc':
      default:
        queryBuilder = queryBuilder
          .order('generation', { ascending: true, nullsFirst: false })
          .order('birth_order', { ascending: true, nullsFirst: false })
          .order('birth_year', { ascending: true, nullsFirst: false })
        break
    }

    queryBuilder = queryBuilder.order('id', { ascending: true })

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const { data, count, error } = await queryBuilder.range(from, to)

    if (error) throw error

    listPersons = (data as Person[]) ?? []
    listTotal = count ?? 0
  }

  // Prepare map and roots for tree views
  const treePersonsMap = new Map<string, Person>()
  treePersons.forEach((p) => treePersonsMap.set(p.id, p))

  const childIds = new Set(
    relationships
      .filter(
        (r) => r.type === 'biological_child' || r.type === 'adopted_child'
      )
      .map((r) => r.person_b)
  )

  let finalRootId = rootId

  // If no rootId is provided, fallback to the earliest created person
  if (!finalRootId || !treePersonsMap.has(finalRootId)) {
    const rootsFallback = treePersons.filter((p) => !childIds.has(p.id))
    if (rootsFallback.length > 0) {
      finalRootId = rootsFallback[0].id
    } else if (treePersons.length > 0) {
      finalRootId = treePersons[0].id // ultimate fallback
    }
  }

  return (
    <MemberListProvider
      initialView={initialView}
      initialRootId={finalRootId}
      initialShowAvatar={initialShowAvatar}>
      <ViewToggle />
      <MembersViews
        persons={treePersons}
        listPersons={listPersons}
        relationships={relationships}
        initialGraphTruncated={treeData.truncated}
        initialGraphDepth={treeData.maxDepth}
        canEdit={canEdit}
        listPagination={{
          page,
          pageSize,
          total: listTotal,
          query,
          filter,
          sort
        }}
      />

      <MemberDetailModal />
    </MemberListProvider>
  )
}
