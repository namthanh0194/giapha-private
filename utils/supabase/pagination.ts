import type { PostgrestError } from '@supabase/supabase-js'

export interface PageResult<T> {
  data: T[] | null
  error: PostgrestError | null
}

export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RangeError('pageSize must be a positive integer')
  }

  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1)

    if (error) throw error

    const page = data ?? []
    rows.push(...page)

    if (page.length < pageSize) return rows
  }
}
