import { describe, expect, test } from 'vitest'
import { computeKinship, type PersonNode } from '@/utils/kinshipHelpers'

const grandfather: PersonNode = {
  id: 'p1',
  full_name: 'Trần Văn A',
  gender: 'male',
  birth_year: 1940,
  birth_order: 1,
  generation: 1,
  is_in_law: false
}

const father: PersonNode = {
  id: 'p2',
  full_name: 'Trần Văn B',
  gender: 'male',
  birth_year: 1965,
  birth_order: 1,
  generation: 2,
  is_in_law: false
}

const grandson: PersonNode = {
  id: 'p3',
  full_name: 'Trần Văn C',
  gender: 'male',
  birth_year: 1995,
  birth_order: 1,
  generation: 3,
  is_in_law: false
}

describe('computeKinship', () => {
  test('returns the direct grandfather-grandson terms', () => {
    const result = computeKinship(
      grandfather,
      grandson,
      [grandfather, father, grandson],
      [
        { type: 'biological_child', person_a: 'p1', person_b: 'p2' },
        { type: 'biological_child', person_a: 'p2', person_b: 'p3' }
      ]
    )

    expect(result).toMatchObject({
      aCallsB: 'Cháu',
      bCallsA: 'Ông nội',
      description: expect.stringContaining('Quan hệ Trực hệ'),
      distance: 2
    })
  })
})
