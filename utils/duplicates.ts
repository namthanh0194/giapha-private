import type { Person } from '@/types'

export type DuplicateSignal =
  | 'full_name'
  | 'other_name'
  | 'gender'
  | 'birth_year'
  | 'birth_month'
  | 'birth_day'
  | 'death_year'
  | 'shared_parent'
  | 'shared_spouse'

export interface DuplicateReason {
  signal: DuplicateSignal
  points: number
  label: string
}

export interface DuplicateScore {
  score: number
  reasons: DuplicateReason[]
}

export interface DuplicateRelationshipPreview {
  id: string
  type: string
  direction: 'incoming' | 'outgoing'
  related_person_id: string
  related_person_name: string
}

export interface DuplicateCitationPreview {
  id: string
  source_title: string
  field_name: string | null
  page_reference: string | null
  quotation: string | null
  confidence: string
}

export type DuplicateFieldKey =
  | 'full_name'
  | 'gender'
  | 'birth_year'
  | 'birth_month'
  | 'birth_day'
  | 'death_year'
  | 'death_month'
  | 'death_day'
  | 'death_lunar_year'
  | 'death_lunar_month'
  | 'death_lunar_day'
  | 'is_deceased'
  | 'is_in_law'
  | 'birth_order'
  | 'generation'
  | 'other_names'
  | 'avatar_url'
  | 'note'
  | 'phone_number'
  | 'occupation'
  | 'current_residence'

export type DuplicatePerson = Person & {
  parent_ids?: string[]
  spouse_ids?: string[]
  phone_number?: string | null
  occupation?: string | null
  current_residence?: string | null
  relationship_previews?: DuplicateRelationshipPreview[]
  citation_previews?: DuplicateCitationPreview[]
}

export const DUPLICATE_FIELDS: ReadonlyArray<{ key: DuplicateFieldKey; label: string }> = [
  { key: 'full_name', label: 'Họ tên' },
  { key: 'gender', label: 'Giới tính' },
  { key: 'birth_year', label: 'Năm sinh' },
  { key: 'birth_month', label: 'Tháng sinh' },
  { key: 'birth_day', label: 'Ngày sinh' },
  { key: 'death_year', label: 'Năm mất' },
  { key: 'death_month', label: 'Tháng mất' },
  { key: 'death_day', label: 'Ngày mất' },
  { key: 'death_lunar_year', label: 'Năm mất âm lịch' },
  { key: 'death_lunar_month', label: 'Tháng mất âm lịch' },
  { key: 'death_lunar_day', label: 'Ngày mất âm lịch' },
  { key: 'is_deceased', label: 'Trạng thái qua đời' },
  { key: 'is_in_law', label: 'Vai trò dâu/rể' },
  { key: 'birth_order', label: 'Thứ tự sinh' },
  { key: 'generation', label: 'Đời thứ' },
  { key: 'other_names', label: 'Tên khác' },
  { key: 'avatar_url', label: 'Ảnh đại diện' },
  { key: 'note', label: 'Ghi chú' },
  { key: 'phone_number', label: 'Số điện thoại' },
  { key: 'occupation', label: 'Nghề nghiệp' },
  { key: 'current_residence', label: 'Nơi ở hiện tại' }
]

export function getDuplicateConflicts(left: DuplicatePerson, right: DuplicatePerson) {
  return DUPLICATE_FIELDS.filter(({ key }) => left[key] !== right[key])
}

const WEIGHTS: Record<DuplicateSignal, number> = {
  full_name: 40,
  other_name: 10,
  gender: 5,
  birth_year: 10,
  birth_month: 5,
  birth_day: 5,
  death_year: 5,
  shared_parent: 10,
  shared_spouse: 10
}

const LABELS: Record<DuplicateSignal, string> = {
  full_name: 'Họ tên trùng khớp',
  other_name: 'Tên khác trùng khớp',
  gender: 'Giới tính trùng khớp',
  birth_year: 'Năm sinh trùng khớp',
  birth_month: 'Tháng sinh trùng khớp',
  birth_day: 'Ngày sinh trùng khớp',
  death_year: 'Năm mất trùng khớp',
  shared_parent: 'Có cha hoặc mẹ chung',
  shared_spouse: 'Có vợ hoặc chồng chung'
}

export function normalizeDuplicateName(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

function nameVariants(value: string | null | undefined) {
  return new Set(
    (value ?? '')
      .split(/[;,/\n]/)
      .map(normalizeDuplicateName)
      .filter(Boolean)
  )
}

function hasOverlap(left: string[] | undefined, right: string[] | undefined) {
  const rightIds = new Set(right ?? [])
  return (left ?? []).some((id) => rightIds.has(id))
}

export function scoreDuplicateCandidate(left: Person, right: Person): DuplicateScore {
  const leftPerson = left as DuplicatePerson
  const rightPerson = right as DuplicatePerson
  const reasons: DuplicateReason[] = []
  const add = (signal: DuplicateSignal) =>
    reasons.push({ signal, points: WEIGHTS[signal], label: LABELS[signal] })

  if (
    normalizeDuplicateName(left.full_name) &&
    normalizeDuplicateName(left.full_name) === normalizeDuplicateName(right.full_name)
  ) add('full_name')

  const leftOtherNames = nameVariants(left.other_names)
  const rightOtherNames = nameVariants(right.other_names)
  if ([...leftOtherNames].some((name) => rightOtherNames.has(name))) add('other_name')
  if (left.gender === right.gender) add('gender')
  if (left.birth_year !== null && left.birth_year === right.birth_year) add('birth_year')
  if (left.birth_month !== null && left.birth_month === right.birth_month) add('birth_month')
  if (left.birth_day !== null && left.birth_day === right.birth_day) add('birth_day')
  if (left.death_year !== null && left.death_year === right.death_year) add('death_year')
  if (hasOverlap(leftPerson.parent_ids, rightPerson.parent_ids)) add('shared_parent')
  if (hasOverlap(leftPerson.spouse_ids, rightPerson.spouse_ids)) add('shared_spouse')

  return {
    score: Math.min(100, reasons.reduce((total, reason) => total + reason.points, 0)),
    reasons
  }
}
