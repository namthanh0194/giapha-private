import type { Person, Relationship } from '@/types'

export interface TreePreviewData {
  ancestor: Pick<Person, 'id' | 'full_name' | 'generation'> | null
  gen2: Pick<Person, 'id' | 'full_name' | 'gender'>[]
  gen3: Pick<Person, 'id' | 'full_name' | 'gender'>[]
}

const EMPTY: TreePreviewData = { ancestor: null, gen2: [], gen3: [] }

export function buildTreePreviewData(
  persons: Pick<
    Person,
    | 'id'
    | 'full_name'
    | 'gender'
    | 'generation'
    | 'birth_order'
    | 'birth_year'
    | 'is_in_law'
  >[],
  relationships: Pick<Relationship, 'type' | 'person_a' | 'person_b'>[]
): TreePreviewData {
  if (!persons.length) return EMPTY

  const byId = new Map(persons.map((p) => [p.id, p]))
  const childrenOf = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type === 'biological_child' || r.type === 'adopted_child') {
      const arr = childrenOf.get(r.person_a) ?? []
      arr.push(r.person_b)
      childrenOf.set(r.person_a, arr)
    }
  }

  const gen1 = persons
    .filter(
      (p) =>
        p.generation === 1 ||
        (!p.generation &&
          !relationships.some(
            (r) =>
              (r.type === 'biological_child' || r.type === 'adopted_child') &&
              r.person_b === p.id
          ))
    )
    .sort(
      (a, b) => (a.gender === 'male' ? -1 : 1) - (b.gender === 'male' ? -1 : 1)
    )

  const ancestor = gen1[0] ?? null

  const gen2: TreePreviewData['gen2'] = []
  if (ancestor) {
    const childIds = childrenOf.get(ancestor.id) ?? []
    for (const cid of childIds) {
      const p = byId.get(cid)
      if (p && !p.is_in_law)
        gen2.push({ id: p.id, full_name: p.full_name, gender: p.gender })
    }
    gen2.sort((a) => (a.gender === 'male' ? -1 : 1))
  }

  const gen3: TreePreviewData['gen3'] = []
  for (const g2 of gen2.slice(0, 3)) {
    const childIds = childrenOf.get(g2.id) ?? []
    for (const cid of childIds.slice(0, 2)) {
      const p = byId.get(cid)
      if (p && !p.is_in_law && gen3.length < 6)
        gen3.push({ id: p.id, full_name: p.full_name, gender: p.gender })
    }
  }

  return { ancestor, gen2: gen2.slice(0, 5), gen3: gen3.slice(0, 6) }
}
