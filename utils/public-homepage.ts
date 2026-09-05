export interface PublicHomepageBranch {
  name: string
  description: string
  members: number
}

export interface PublicHomepageEvent {
  date: string
  month: string
  title: string
  detail: string
}

export interface PublicHomepageSummary {
  totalMembers: number
  totalGenerations: number
  totalBranches: number
  ancestorName: string
  branches: PublicHomepageBranch[]
  events: PublicHomepageEvent[]
}

export interface RawHomepageSummaryRpc {
  total_members?: number | null
  total_generations?: number | null
  total_branches?: number | null
  ancestor?: { full_name?: string | null } | null
  branches?: Array<{
    name?: string | null
    description?: string | null
    members?: number | null
  }> | null
  events?: Array<{
    date?: string | null
    month?: string | null
    title?: string | null
    detail?: string | null
  }> | null
}

export const fallbackHomepageSummary: PublicHomepageSummary = {
  totalMembers: 0,
  totalGenerations: 0,
  totalBranches: 0,
  ancestorName: 'Chưa cập nhật',
  branches: [],
  events: []
}

export function normalizeHomepageSummary(
  raw?: RawHomepageSummaryRpc | null
): PublicHomepageSummary {
  if (!raw || typeof raw !== 'object') return fallbackHomepageSummary

  const totalMembers =
    typeof raw.total_members === 'number' && raw.total_members >= 0
      ? raw.total_members
      : fallbackHomepageSummary.totalMembers
  const totalGenerations =
    typeof raw.total_generations === 'number' && raw.total_generations >= 0
      ? raw.total_generations
      : fallbackHomepageSummary.totalGenerations
  const ancestorName =
    raw.ancestor?.full_name?.trim() || fallbackHomepageSummary.ancestorName

  const branches = Array.isArray(raw.branches)
    ? raw.branches.map((b, index) => ({
        name: b.name?.trim() || `Chi ${index + 1}`,
        description: b.description?.trim() || 'Hậu duệ các đời tiếp nối',
        members: typeof b.members === 'number' ? b.members : 0
      }))
    : fallbackHomepageSummary.branches

  const events = Array.isArray(raw.events)
    ? raw.events.map((e) => ({
        date: e.date?.trim() || '01',
        month: e.month?.trim() || 'Tháng 01',
        title: e.title?.trim() || 'Sự kiện dòng họ',
        detail: e.detail?.trim() || 'Nhà thờ họ'
      }))
    : fallbackHomepageSummary.events

  return {
    totalMembers,
    totalGenerations,
    totalBranches: branches.length,
    ancestorName,
    branches,
    events
  }
}
