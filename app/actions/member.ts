'use server'

import { toPublicError } from '@/utils/errors'
import { withTelemetry } from '@/utils/telemetry'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type VersionedRecordChanges = Record<string, unknown>

export type UpdateMemberActionResult =
  | { success: true; version: number }
  | { success: false; conflict: true; error: string }
  | { success: false; conflict?: false; error: string; errorId?: string }

type VersionedActionResult =
  | { success: true; version?: number }
  | { success: false; conflict: true; error: string }
  | { success: false; conflict?: false; error: string; errorId?: string }

function isValidVersionedInput(id: string, expectedVersion: number) {
  return UUID_PATTERN.test(id) && Number.isSafeInteger(expectedVersion) && expectedVersion >= 1
}

async function updateVersionedRecordAction(
  targetTable: 'custom_events',
  id: string,
  expectedVersion: number,
  changes: VersionedRecordChanges
): Promise<VersionedActionResult> {
  if (!isValidVersionedInput(id, expectedVersion)) {
    return { success: false, error: 'Dữ liệu phiên bản không hợp lệ.' }
  }

  const profile = await getProfile()
  if (!profile?.is_active || (profile.role !== 'admin' && profile.role !== 'editor')) {
    return { success: false, error: 'Từ chối truy cập.' }
  }

  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('update_versioned_record', {
    target_table: targetTable,
    target_id: id,
    expected_version: expectedVersion,
    changes
  })

  if (error?.code === '40001') {
    return { success: false, conflict: true, error: 'Dữ liệu đã được người khác cập nhật.' }
  }

  if (error || !Number.isSafeInteger(data)) {
    const publicError = toPublicError(
      error ?? new Error('Versioned update returned no version.'),
      'Không thể cập nhật dữ liệu.',
      { event: 'record.update.failed', fields: { targetTable, id, expectedVersion } }
    )
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  return { success: true, version: data }
}

async function deleteVersionedRecordAction(
  targetTable: 'relationships' | 'custom_events',
  id: string,
  expectedVersion: number
): Promise<VersionedActionResult> {
  if (!isValidVersionedInput(id, expectedVersion)) {
    return { success: false, error: 'Dữ liệu phiên bản không hợp lệ.' }
  }

  const profile = await getProfile()
  if (!profile?.is_active || (profile.role !== 'admin' && profile.role !== 'editor')) {
    return { success: false, error: 'Từ chối truy cập.' }
  }

  const supabase = await getSupabase()
  const { error } = await supabase.rpc('delete_versioned_record', {
    target_table: targetTable,
    target_id: id,
    expected_version: expectedVersion
  })

  if (error?.code === '40001') {
    return { success: false, conflict: true, error: 'Dữ liệu đã được người khác cập nhật.' }
  }

  if (error) {
    const publicError = toPublicError(error, 'Không thể xóa dữ liệu.', {
      event: 'record.delete.failed', fields: { targetTable, id, expectedVersion }
    })
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  return { success: true }
}

export async function updateCustomEventAction(
  eventId: string,
  expectedVersion: number,
  changes: VersionedRecordChanges
) {
  return await withTelemetry('event.update', { route: '/actions/member', roleClass: 'unknown' }, async () =>
    updateVersionedRecordAction('custom_events', eventId, expectedVersion, changes)
  )
}

export async function deleteCustomEventAction(eventId: string, expectedVersion: number) {
  return await withTelemetry('event.delete', { route: '/actions/member', roleClass: 'unknown' }, async () =>
    deleteVersionedRecordAction('custom_events', eventId, expectedVersion)
  )
}

export async function deleteRelationshipAction(relationshipId: string, expectedVersion: number) {
  return await withTelemetry('relationship.delete', { route: '/actions/member', roleClass: 'unknown' }, async () =>
    deleteVersionedRecordAction('relationships', relationshipId, expectedVersion)
  )
}

export async function createRelationshipAction(
  personA: string,
  personB: string,
  type: 'marriage' | 'biological_child' | 'adopted_child',
  note?: string | null
) {
  return await withTelemetry('relationship.create', { route: '/actions/member', roleClass: 'unknown' }, async () => {
    if (!UUID_PATTERN.test(personA) || !UUID_PATTERN.test(personB) || personA === personB) {
      return { success: false, error: 'Mối quan hệ không hợp lệ.' }
    }
    if (!['marriage', 'biological_child', 'adopted_child'].includes(type)) {
      return { success: false, error: 'Loại mối quan hệ không hợp lệ.' }
    }

    const profile = await getProfile()
    if (!profile?.is_active || (profile.role !== 'admin' && profile.role !== 'editor')) {
      return { success: false, error: 'Từ chối truy cập.' }
    }

    const supabase = await getSupabase()
    const { error } = await supabase.from('relationships').insert({
      person_a: personA,
      person_b: personB,
      type,
      note: note?.trim() || null
    })

    if (error) {
      const publicError = toPublicError(error, 'Không thể thêm mối quan hệ.', {
        event: 'relationship.create.failed',
        fields: { personA, personB, type }
      })
      return { success: false, error: publicError.message, errorId: publicError.id }
    }

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/members')
    return { success: true }
  })
}

export async function updateMemberAction(
  memberId: string,
  expectedVersion: number,
  changes: VersionedRecordChanges
): Promise<UpdateMemberActionResult> {
  return await withTelemetry('member.update', { route: '/actions/member', roleClass: 'unknown' }, async () => {
  if (!UUID_PATTERN.test(memberId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return { success: false, error: 'Hồ sơ không hợp lệ.' }
  }

  const profile = await getProfile()
  if (!profile?.is_active || (profile.role !== 'admin' && profile.role !== 'editor')) {
    return { success: false, error: 'Từ chối truy cập.' }
  }

  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('update_versioned_record', {
    target_table: 'persons',
    target_id: memberId,
    expected_version: expectedVersion,
    changes
  })

  if (error?.code === '40001') {
    return {
      success: false,
      conflict: true,
      error: 'Dữ liệu đã được người khác cập nhật.'
    }
  }

  if (error || !Number.isSafeInteger(data)) {
    const publicError = toPublicError(
      error ?? new Error('Versioned person update returned no version.'),
      'Không thể cập nhật hồ sơ.',
      { event: 'member.update.failed', fields: { memberId, expectedVersion } }
    )
    return { success: false, error: publicError.message, errorId: publicError.id }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/members/' + memberId)
  return { success: true, version: data }
  })
}

export async function deleteMemberProfile(memberId: string, expectedVersion: number = 1) {
  return await withTelemetry('member.delete', { route: '/actions/member', roleClass: 'unknown' }, async (scope) => {
  if (!UUID_PATTERN.test(memberId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return { error: 'Hồ sơ không hợp lệ.' }
  }

  const profile = await getProfile()
  const supabase = await getSupabase()

  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error: 'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền xoá hồ sơ.'
    }
  }

  // 2. Check for existing relationships
  const { data: relationships, error: relationshipError } = await supabase
    .from('relationships')
    .select('id')
    .or(`person_a.eq.${memberId},person_b.eq.${memberId}`)
    .limit(1)

  if (relationshipError) {
    const publicError = toPublicError(
      relationshipError,
      'Lỗi kiểm tra mối quan hệ gia đình.',
      { event: 'member.delete.relationship_check_failed', fields: { memberId } }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  if (relationships && relationships.length > 0) {
    return {
      error:
        'Không thể xoá. Vui lòng xoá hết các mối quan hệ gia đình của người này trước.'
    }
  }

  // 3. Delete the member using OCC
  const { error: deleteError } = await supabase.rpc('delete_versioned_record', {
    target_table: 'persons',
    target_id: memberId,
    expected_version: expectedVersion
  })

  if (deleteError?.code === '40001') {
    return { error: 'Dữ liệu đã được người khác cập nhật.' }
  }

  if (deleteError) {
    const publicError = toPublicError(
      deleteError,
      'Đã xảy ra lỗi khi xoá hồ sơ.',
      { event: 'member.delete.failed', fields: { memberId } }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  // 4. Revalidate and redirect
  revalidatePath('/dashboard/members')
  scope.add({ status: 200 })
  redirect('/dashboard/members')
  })
}

export async function updateDescendantGenerationsAction(
  personId: string,
  generationDelta: number
) {
  return await withTelemetry('member.update_descendant_generations', { route: '/actions/member', roleClass: 'unknown' }, async () => {
  if (!UUID_PATTERN.test(personId)) {
    return { error: 'Hồ sơ không hợp lệ.' }
  }

  if (
    generationDelta === 0 ||
    !Number.isInteger(generationDelta) ||
    Math.abs(generationDelta) > 100
  ) {
    return generationDelta === 0
      ? { success: true }
      : { error: 'Giá trị thay đổi thế hệ không hợp lệ.' }
  }

  const profile = await getProfile()
  const supabase = await getSupabase()

  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error: 'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền chỉnh sửa.'
    }
  }

  // 1. Fetch all parent-child relationships
  const { data: relationships, error: relError } = await supabase
    .from('relationships')
    .select('person_a, person_b, type')
    .in('type', ['biological_child', 'adopted_child'])

  if (relError) {
    const publicError = toPublicError(relError, 'Lỗi lấy danh sách quan hệ.', {
      event: 'member.cascade_generation.relationships_failed',
      fields: { personId }
    })
    return { error: publicError.message, errorId: publicError.id }
  }

  // Build children map (person_a is parent, person_b is child)
  const childrenMap = new Map<string, string[]>()
  relationships.forEach((r) => {
    if (!childrenMap.has(r.person_a)) childrenMap.set(r.person_a, [])
    childrenMap.get(r.person_a)!.push(r.person_b)
  })

  // 2. Find all descendants using BFS
  const descendants = new Set<string>()
  const queue = [personId]
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = childrenMap.get(current) || []
    for (const child of children) {
      if (!descendants.has(child)) {
        descendants.add(child)
        queue.push(child)
      }
    }
  }

  if (descendants.size === 0) return { success: true }
  const descendantIds = Array.from(descendants)

  // 3. Fetch current generations of descendants
  const { data: persons, error: personsError } = await supabase
    .from('persons')
    .select('id, version, generation')
    .in('id', descendantIds)

  if (personsError) {
    const publicError = toPublicError(personsError, 'Lỗi lấy thông tin thế hệ.', {
      event: 'member.cascade_generation.persons_failed',
      fields: { personId, descendantCount: descendantIds.length }
    })
    return { error: publicError.message, errorId: publicError.id }
  }

  // 4. Update each descendant's generation
  let updateFailure: { id: string; message: string } | null = null
  // Batch processing can be done by looping
  for (const person of persons) {
    if (person.generation !== null && person.generation !== undefined) {
      const newGen = Math.max(1, person.generation + generationDelta)
      const { error: updateError } = await supabase.rpc('update_versioned_record', {
        target_table: 'persons',
        target_id: person.id,
        expected_version: person.version ?? 1,
        changes: { generation: newGen }
      })

      if (updateError) {
        if (updateError.code === '40001') {
          return { error: 'Dữ liệu đã được người khác cập nhật.' }
        }
        updateFailure ||= toPublicError(
          updateError,
          'Có lỗi xảy ra khi cập nhật một số thế hệ sau.',
          {
            event: 'member.cascade_generation.update_failed',
            fields: { personId, failedPersonId: person.id }
          }
        )
      }
    }
  }

  if (updateFailure) {
    return { error: updateFailure.message, errorId: updateFailure.id }
  }

  return { success: true }
  })
}

export interface SpouseInput {
  full_name: string
  gender: 'male' | 'female' | 'other'
  birth_year?: number | null
  generation?: number | null
  is_in_law?: boolean
  other_names?: string | null
  avatar_url?: string | null
  note?: string | null
}

export interface ChildInput {
  full_name: string
  gender: 'male' | 'female' | 'other'
  birth_year?: number | null
  birth_order?: number | null
  generation?: number | null
  other_names?: string | null
  avatar_url?: string | null
  note?: string | null
}

export async function createSpouseAction(
  personId: string,
  spouse: SpouseInput,
  relationshipNote?: string | null
) {
  return await withTelemetry('member.create_spouse', { route: '/actions/member', roleClass: 'unknown' }, async () => {
  if (!UUID_PATTERN.test(personId)) {
    return { error: 'Hồ sơ không hợp lệ.' }
  }
  if (
    !spouse ||
    typeof spouse.full_name !== 'string' ||
    !spouse.full_name.trim()
  ) {
    return { error: 'Tên vợ/chồng không được để trống.' }
  }

  const profile = await getProfile()
  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error:
        'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền thêm quan hệ.'
    }
  }

  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('create_spouse', {
    person_id: personId,
    spouse: {
      full_name: spouse.full_name.trim(),
      gender: spouse.gender,
      birth_year: spouse.birth_year ?? null,
      generation: spouse.generation ?? null,
      is_in_law: spouse.is_in_law ?? true,
      other_names: spouse.other_names ?? null,
      avatar_url: spouse.avatar_url ?? null,
      note: spouse.note ?? null
    },
    relationship_note: relationshipNote || null
  })

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể thêm vợ/chồng. Vui lòng kiểm tra lại thông tin.',
      {
        event: 'member.add_spouse.failed',
        fields: { personId }
      }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  return { success: true, spouseId: data as string }
  })
}

export async function createChildrenAction(
  parentIds: string[],
  children: ChildInput[]
) {
  return await withTelemetry('member.create_children', { route: '/actions/member', roleClass: 'unknown' }, async (scope) => {
  if (
    !Array.isArray(parentIds) ||
    parentIds.length === 0 ||
    parentIds.length > 2
  ) {
    return { error: 'Số lượng cha/mẹ không hợp lệ.' }
  }
  for (const pid of parentIds) {
    if (!UUID_PATTERN.test(pid)) return { error: 'ID cha/mẹ không hợp lệ.' }
  }
  if (
    !Array.isArray(children) ||
    children.length === 0 ||
    children.length > 100
  ) {
    return { error: 'Danh sách con không hợp lệ.' }
  }

  const profile = await getProfile()
  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error: 'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền thêm con.'
    }
  }

  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('create_children', {
    parent_ids: parentIds,
    children: children.map((c) => ({
      full_name: c.full_name.trim(),
      gender: c.gender,
      birth_year: c.birth_year ?? null,
      birth_order: c.birth_order ?? null,
      generation: c.generation ?? null,
      other_names: c.other_names ?? null,
      avatar_url: c.avatar_url ?? null,
      note: c.note ?? null
    }))
  })

  if (error) {
    const publicError = toPublicError(
      error,
      'Không thể thêm con. Vui lòng kiểm tra lại thông tin.',
      {
        event: 'member.add_child.failed',
        fields: { parentIds, childrenCount: children.length }
      }
    )
    return { error: publicError.message, errorId: publicError.id }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  scope.add({ rowCount: (data as { created: number; ids: string[] }).created })
  return { success: true, result: data as { created: number; ids: string[] } }
  })
}
