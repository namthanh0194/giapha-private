import { Profile, type Person } from '@/types'
import { logWarn } from '@/utils/logger'
import { fetchFamilySubtree } from '@/utils/supabase/family-graph'
import type { HomepageFamilyTreeData } from '@/components/HomepageFamilyTree'
import {
  fallbackHomepageSummary,
  normalizeHomepageSummary,
  type PublicHomepageSummary,
  type RawHomepageSummaryRpc
} from '@/utils/public-homepage'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { cache } from 'react'

// Hàm này được cache lại để đảm bảo chỉ tạo 1 Supabase Client duy nhất cho mỗi request
export const getSupabase = cache(async () => {
  const cookieStore = await cookies()
  return createClient(cookieStore)
})

export const getUser = cache(async () => {
  const supabase = await getSupabase()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  return user
})

export const getProfile = cache(async (userId?: string) => {
  let id = userId
  if (!id) {
    const user = await getUser()
    if (!user) return null
    id = user.id
  }

  const supabase = await getSupabase()
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single()

  return profile as Profile | null
})

export const getIsAdmin = cache(async () => {
  const profile = await getProfile()
  return profile?.role === 'admin' && profile.is_active
})

export const getPublicHomepageSummary = cache(
  async (): Promise<PublicHomepageSummary> => {
    try {
      const supabase = await getSupabase()
      const { data, error } = await supabase.rpc('get_public_homepage_summary')
      if (error) {
        logWarn('homepage.summary_rpc_failed', { error: error.message })
        return fallbackHomepageSummary
      }
      return normalizeHomepageSummary(data as RawHomepageSummaryRpc)
    } catch (error) {
      logWarn('homepage.summary_fetch_exception', {
        error: error instanceof Error ? error.message : String(error)
      })
      return fallbackHomepageSummary
    }
  }
)

export const getHomepageFamilyTree = cache(
  async (): Promise<HomepageFamilyTreeData | null> => {
    if (!(await getUser())) return null

    try {
      const supabase = await getSupabase()
      const { data: root, error: rootError } = await supabase
        .from('persons')
        .select('id')
        .order('generation', { ascending: true, nullsFirst: false })
        .order('birth_year', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (rootError || !root) return null

      const graph = await fetchFamilySubtree(supabase, {
        rootId: root.id,
        maxDepth: 6,
        includeSpouses: false
      })

      return {
        rootId: root.id,
        persons: graph.persons as Person[],
        relationships: graph.relationships,
        truncated: graph.truncated
      }
    } catch (error) {
      logWarn('homepage.family_tree_failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
)
