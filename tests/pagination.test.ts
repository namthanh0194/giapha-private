import { PostgrestError } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { fetchAllRows } from '@/utils/supabase/pagination'

describe('fetchAllRows', () => {
  it.each([0, 1, 999, 1000, 1001, 2000, 2001])(
    'returns every row for %i rows without duplicates',
    async (rowCount) => {
      const rows = Array.from({ length: rowCount }, (_, id) => ({ id }))
      const requestedRanges: Array<[number, number]> = []

      const result = await fetchAllRows(async (from, to) => {
        requestedRanges.push([from, to])
        return { data: rows.slice(from, to + 1), error: null }
      })

      expect(result.map((row) => row.id)).toEqual(rows.map((row) => row.id))
      expect(new Set(result.map((row) => row.id)).size).toBe(rowCount)
      const pageCount = Math.floor(rowCount / 1000) + 1
      expect(requestedRanges).toEqual(
        Array.from({ length: pageCount }, (_, page) => [
          page * 1000,
          page * 1000 + 999
        ])
      )
    }
  )

  it('throws the original PostgREST error', async () => {
    const error = new PostgrestError({
      message: 'permission denied',
      details: '',
      hint: '',
      code: '42501'
    })

    await expect(
      fetchAllRows(async () => ({ data: null, error }))
    ).rejects.toBe(error)
  })

  it.each([0, -1, -500, 1.5, Number.NaN, -Infinity, Infinity])(
    'rejects with RangeError when pageSize is invalid (%s)',
    async (pageSize) => {
      const queryPage = vi.fn(async () => ({ data: [], error: null }))

      await expect(fetchAllRows(queryPage, pageSize)).rejects.toThrow(
        RangeError
      )
      expect(queryPage).not.toHaveBeenCalled()
    }
  )
})
