import type { Person } from '@/types'
import { getDuplicateConflicts, normalizeDuplicateName, scoreDuplicateCandidate } from '@/utils/duplicates'
import { describe, expect, test } from 'vitest'

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: crypto.randomUUID(),
    full_name: 'Nguyễn Văn An',
    gender: 'male',
    birth_year: null,
    birth_month: null,
    birth_day: null,
    death_year: null,
    death_month: null,
    death_day: null,
    death_lunar_year: null,
    death_lunar_month: null,
    death_lunar_day: null,
    avatar_url: null,
    note: null,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    is_deceased: false,
    is_in_law: false,
    birth_order: null,
    generation: null,
    other_names: null,
    privacy_level: 'family',
    ...overrides
  }
}

describe('scoreDuplicateCandidate', () => {
  test('matches Vietnamese diacritics and case-insensitively', () => {
    const score = scoreDuplicateCandidate(
      person({ full_name: 'Nguyễn Văn Ánh' }),
      person({ full_name: 'nguyen van anh' })
    )
    expect(score.score).toBeGreaterThanOrEqual(40)
    expect(score.reasons.map((reason) => reason.signal)).toContain('full_name')
  })

  test('matches reversed Vietnamese name order', () => {
    const score = scoreDuplicateCandidate(
      person({ full_name: 'Trần Thị Mai' }),
      person({ full_name: 'Mai Thi Tran' })
    )
    expect(score.reasons.map((reason) => reason.signal)).toContain('full_name')
  })

  test('scores only known overlapping birth date components', () => {
    const score = scoreDuplicateCandidate(
      person({ birth_year: 1945, birth_month: null, birth_day: null }),
      person({ birth_year: 1945, birth_month: 8, birth_day: null })
    )
    expect(score.reasons.map((reason) => reason.signal)).toContain('birth_year')
    expect(score.reasons.map((reason) => reason.signal)).not.toContain('birth_month')
    expect(score.reasons.map((reason) => reason.signal)).not.toContain('birth_day')
  })

  test('does not treat same names from different generations as high confidence', () => {
    const score = scoreDuplicateCandidate(
      person({ full_name: 'Lê Văn Bình', birth_year: 1910, generation: 2 }),
      person({ full_name: 'Lê Văn Bình', birth_year: 1985, generation: 5 })
    )
    expect(score.score).toBeLessThan(50)
  })

  test('adds evidence for a shared spouse without auto-merging', () => {
    const sharedSpouse = crypto.randomUUID()
    const score = scoreDuplicateCandidate(
      Object.assign(person({ full_name: 'Phạm Thị Lan' }), { spouse_ids: [sharedSpouse] }),
      Object.assign(person({ full_name: 'Lan Thi Pham' }), { spouse_ids: [sharedSpouse] })
    )
    expect(score.reasons.map((reason) => reason.signal)).toContain('shared_spouse')
    expect(score).not.toHaveProperty('autoMerge')
  })

  test('detects conflicts across lunar dates, status, family metadata and private details', () => {
    const primary = Object.assign(
      person({ full_name: 'Nguyễn Văn A', is_deceased: false, is_in_law: false, birth_order: 1, generation: 3, death_lunar_year: 2020, death_lunar_month: 5, death_lunar_day: 15 }),
      { phone_number: '0987654321', occupation: 'Giáo viên', current_residence: 'Đà Nẵng' }
    )
    const duplicate = Object.assign(
      person({ full_name: 'Nguyễn Văn A', is_deceased: true, is_in_law: true, birth_order: 2, generation: 4, death_lunar_year: 2021, death_lunar_month: 6, death_lunar_day: 16 }),
      { phone_number: '0901234567', occupation: 'Kỹ sư', current_residence: 'Hà Nội' }
    )

    const keys = getDuplicateConflicts(primary, duplicate).map((item) => item.key)
    expect(keys).toEqual(expect.arrayContaining([
      'is_deceased', 'is_in_law', 'birth_order', 'generation',
      'death_lunar_year', 'death_lunar_month', 'death_lunar_day',
      'phone_number', 'occupation', 'current_residence'
    ]))
    expect(normalizeDuplicateName('Đặng Đình Đức')).toBe(normalizeDuplicateName('dang dinh duc'))
  })
})
