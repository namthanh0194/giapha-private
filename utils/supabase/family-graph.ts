import type { SupabaseClient } from '@supabase/supabase-js'
import type { Person, Relationship } from '@/types'
import { withTelemetry } from '@/utils/telemetry'

export interface FamilyGraph {
  persons: Person[]
  relationships: Relationship[]
  truncated: boolean
  maxDepth: number
}

const emptyGraph: FamilyGraph = { persons: [], relationships: [], truncated: false, maxDepth: 1 }

function parseGraph(data: unknown): FamilyGraph {
  if (!data || typeof data !== 'object') return emptyGraph
  const graph = data as Partial<FamilyGraph>
  return {
    persons: Array.isArray(graph.persons) ? graph.persons : [],
    relationships: Array.isArray(graph.relationships) ? graph.relationships : [],
    truncated: graph.truncated === true,
    maxDepth: typeof graph.maxDepth === 'number' ? graph.maxDepth : 1
  }
}

export async function fetchFamilySubtree(
  supabase: SupabaseClient,
  input: { rootId: string; maxDepth: number; includeSpouses: boolean }
): Promise<FamilyGraph> {
  return await withTelemetry('graph.family_subtree', { route: '/dashboard/members', roleClass: 'member' }, async (scope) => {
  const { data, error } = await supabase.rpc('get_family_subtree', {
    root_id: input.rootId,
    max_depth: Math.min(10, Math.max(1, input.maxDepth)),
    include_spouses: input.includeSpouses
  })
  if (error) throw error
  const graph = parseGraph(data)
  scope.add({ rowCount: graph.persons.length + graph.relationships.length, truncated: graph.truncated })
  return graph
  })
}

export async function fetchPersonNeighborhood(
  supabase: SupabaseClient,
  input: { personId: string; ancestorDepth: number; descendantDepth: number }
): Promise<FamilyGraph> {
  return await withTelemetry('graph.person_neighborhood', { route: '/dashboard/members', roleClass: 'member' }, async (scope) => {
  const { data, error } = await supabase.rpc('get_person_neighborhood', {
    person_id: input.personId,
    ancestor_depth: Math.min(10, Math.max(1, input.ancestorDepth)),
    descendant_depth: Math.min(10, Math.max(1, input.descendantDepth))
  })
  if (error) throw error
  const graph = parseGraph(data)
  scope.add({ rowCount: graph.persons.length + graph.relationships.length, truncated: graph.truncated })
  return graph
  })
}

export function mergeGraphDelta(
  personsMap: Map<string, Person>,
  relationships: Relationship[],
  delta: FamilyGraph
) {
  const nextPersonsMap = new Map(personsMap)
  delta.persons.forEach((person) => nextPersonsMap.set(person.id, person))
  const relationshipMap = new Map(relationships.map((relationship) => [relationship.id, relationship]))
  delta.relationships.forEach((relationship) => relationshipMap.set(relationship.id, relationship))
  return { personsMap: nextPersonsMap, relationships: [...relationshipMap.values()] }
}
