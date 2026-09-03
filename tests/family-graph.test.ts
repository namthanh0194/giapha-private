import { describe, expect, it, vi } from 'vitest'
import { fetchFamilySubtree, fetchPersonNeighborhood, mergeGraphDelta } from '@/utils/supabase/family-graph'
import type { Person, Relationship } from '@/types'

const person = (id: string, fullName: string) => ({ id, full_name: fullName } as Person)

describe('family graph utilities', () => {
  it('merges a bounded delta by ID', () => {
    const relationships: Relationship[] = [{ id: 'r1', type: 'biological_child', person_a: 'p1', person_b: 'p2', note: null, created_at: '', updated_at: '' }]
    const result = mergeGraphDelta(new Map([['p1', person('p1', 'Cũ')]]), relationships, {
      persons: [person('p1', 'Mới'), person('p2', 'Con')],
      relationships: [
        { id: 'r1', type: 'biological_child', person_a: 'p1', person_b: 'p2', note: null, created_at: '', updated_at: '' },
        { id: 'r2', type: 'biological_child', person_a: 'p2', person_b: 'p3', note: null, created_at: '', updated_at: '' }
      ],
      truncated: true,
      maxDepth: 4
    })
    expect(result.personsMap.get('p1')?.full_name).toBe('Mới')
    expect(result.personsMap.size).toBe(2)
    expect(result.relationships).toHaveLength(2)
  })

  it('calls bounded RPCs with the expected argument names', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { persons: [], relationships: [], truncated: false, maxDepth: 2 }, error: null })
    await fetchFamilySubtree({ rpc } as never, { rootId: 'root', maxDepth: 2, includeSpouses: true })
    await fetchPersonNeighborhood({ rpc } as never, { personId: 'person', ancestorDepth: 1, descendantDepth: 2 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_family_subtree', { root_id: 'root', max_depth: 2, include_spouses: true })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_person_neighborhood', { person_id: 'person', ancestor_depth: 1, descendant_depth: 2 })
  })
})
