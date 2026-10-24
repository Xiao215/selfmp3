import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * What a device counts for its server owner's admin page (usage.ts): names
 * only, a day at a time, sent the day after, and nothing while it is off.
 */

const mocks = vi.hoisted(() => ({ prefs: new Map<string, string>() }))

vi.mock('../../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mocks.prefs.get(key) ?? null,
    set: (key: string, value: string) => mocks.prefs.set(key, value),
  },
}))

const { countShownError, countUse, pendingReports, sentReport, setUsageCounting } =
  await import('./usage')

const DAY_MS = 24 * 60 * 60 * 1000

afterEach(() => {
  vi.useRealTimers()
  setUsageCounting(true)
  mocks.prefs.clear()
})

describe('counting features', () => {
  it('sends a finished day once, and keeps today until it is over', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-22T20:00:00Z') })
    countUse('search')
    countUse('search')
    countShownError('server-away')
    // Not yet: the day is not over.
    expect(pendingReports()).toEqual([])

    vi.setSystemTime(Date.parse('2026-10-23T09:00:00Z'))
    countUse('lyrics')
    expect(pendingReports()).toEqual([
      { day: '2026-10-22', uses: { search: 2 }, errors: { 'server-away': 1 } },
    ])
    sentReport('2026-10-22')
    expect(pendingReports()).toEqual([])

    vi.setSystemTime(Date.parse('2026-10-24T09:00:00Z'))
    expect(pendingReports()).toEqual([{ day: '2026-10-23', uses: { lyrics: 1 }, errors: {} }])
  })

  it('counts nothing while off, and forgets what it had', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-22T20:00:00Z') })
    countUse('ask')
    setUsageCounting(false)
    countUse('ask')
    vi.setSystemTime(Date.parse('2026-10-23T09:00:00Z'))
    expect(pendingReports()).toEqual([])
    expect(mocks.prefs.get('usageCounting')).toBe('off')
  })

  it('lets a day go that waited more than a week for a server', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T12:00:00Z') })
    countUse('room')
    vi.setSystemTime(Date.parse('2026-10-01T12:00:00Z') + 9 * DAY_MS)
    expect(pendingReports()).toEqual([])
    expect(JSON.parse(mocks.prefs.get('usageCounts') ?? '{}')).toEqual({})
  })
})
