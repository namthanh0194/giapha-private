import { describe, expect, test } from 'vitest'
import {
  formatDisplayDate,
  getLunarDateString,
  getSolarDateString
} from '@/utils/dateHelpers'

describe('dateHelpers', () => {
  test('formats complete and unknown Gregorian dates', () => {
    expect(formatDisplayDate(1990, 5, 1)).toBe('01/05/1990')
    expect(formatDisplayDate(null, null, null)).toBe('Chưa rõ')
  })

  test('converts Tet Giap Thin between solar and lunar dates', () => {
    expect(getLunarDateString(2024, 2, 10)).toBe('01/01/2024')
    expect(getSolarDateString(2024, 1, 1)).toBe('10/02/2024')
  })
})
