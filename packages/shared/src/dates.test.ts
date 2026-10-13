import { describe, expect, it } from 'vitest'
import { calendarDaysAgo, localDayKey, startOfLocalDay, WEEKDAYS } from './dates.js'

describe('calendar days', () => {
  it('counts by the day the reader is in, not by 24-hour spans', () => {
    const now = new Date(2026, 8, 14, 8, 0)
    const lastNight = new Date(2026, 8, 13, 23, 0)
    expect(calendarDaysAgo(lastNight.toISOString(), now)?.days).toBe(1)
    expect(calendarDaysAgo(now.toISOString(), now)?.days).toBe(0)
    expect(calendarDaysAgo(new Date(2026, 8, 16).toISOString(), now)?.days).toBe(-2)
  })

  it('has nothing to say about a stamp it cannot read', () => {
    expect(calendarDaysAgo('not a date', new Date())).toBeNull()
  })

  it('starts the day at local midnight, and the week on Sunday', () => {
    expect(startOfLocalDay(new Date(2026, 8, 14, 15, 30))).toBe(new Date(2026, 8, 14).getTime())
    expect(WEEKDAYS[new Date(2026, 8, 13).getDay()]).toBe('Sunday')
  })
})

describe('localDayKey', () => {
  it('is the day where the reader is, as the server writes it', () => {
    expect(localDayKey(new Date(2026, 8, 4, 23, 30))).toBe('2026-09-04')
    expect(localDayKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31')
  })
})
