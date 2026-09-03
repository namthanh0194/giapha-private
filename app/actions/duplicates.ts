'use server'

import { scoreDuplicateCandidate, type DuplicateFieldKey, type DuplicatePerson, type DuplicateScore } from '@/utils/duplicates'
import { toPublicError } from '@/utils/errors'
import { getProfile, getSupabase } from '@/utils/supabase/queries'
import { revalidatePath } from 'next/cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DuplicateCandidate {
  primary: DuplicatePerson
  duplicate: DuplicatePerson
  score: DuplicateScore
}

const PRIVATE_FIELD_KEYS = new Set<DuplicateFieldKey>(['phone_number', 'occupation', 'current_residence'])

function canReview(profile: Awaited<ReturnType<typeof getProfile>>) {
  return profile?.is_active && (profile.role === 'admin' || profile.role === 'editor')
}

export async function getDuplicateCandidates(page = 1): Promise<{ candidates: DuplicateCandidate[]; error?: string }> {
  const profile = await getProfile()
  if (!canReview(profile)) return { candidates: [], error: 'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền rà soát.' }

  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('find_duplicate_candidates', {
    candidate_limit: 25,
    candidate_offset: (safePage - 1) * 25
  })
  if (error) return { candidates: [], error: toPublicError(error, 'Không thể tìm hồ sơ nghi trùng.').message }

  return {
    candidates: ((data ?? []) as Array<{ primary_person: unknown; duplicate_person: unknown }>).map((row) => {
      const primary = row.primary_person as DuplicatePerson
      const duplicate = row.duplicate_person as DuplicatePerson
      return { primary, duplicate, score: scoreDuplicateCandidate(primary, duplicate) }
    })
  }
}

export async function mergeDuplicatePersons(primaryId: string, duplicateId: string, resolution: Partial<Record<DuplicateFieldKey, 'primary' | 'duplicate'>>) {
  if (!UUID_PATTERN.test(primaryId) || !UUID_PATTERN.test(duplicateId) || primaryId === duplicateId) {
    return { error: 'Hồ sơ hợp nhất không hợp lệ.' }
  }
  const profile = await getProfile()
  if (!canReview(profile)) return { error: 'Từ chối truy cập. Chỉ Admin hoặc Editor mới có quyền hợp nhất.' }

  const supabase = await getSupabase()
  const fields: Record<string, 'primary' | 'duplicate'> = {}
  const privateFields: Record<string, 'primary' | 'duplicate'> = {}
  for (const [field, choice] of Object.entries(resolution)) {
    if (!choice) continue
    if (PRIVATE_FIELD_KEYS.has(field as DuplicateFieldKey)) privateFields[field] = choice
    else fields[field] = choice
  }
  const { error } = await supabase.rpc('merge_person_records', {
    primary_id: primaryId,
    duplicate_id: duplicateId,
    resolution: { fields, private_fields: privateFields }
  })
  if (error) return { error: toPublicError(error, 'Không thể hợp nhất hồ sơ.').message }
  revalidatePath('/dashboard/duplicates')
  revalidatePath('/dashboard')
  return { success: true }
}
