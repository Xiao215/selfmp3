import { act, renderHook } from '@testing-library/react-native'
import type { UsageReport } from '@selfmp3/shared'

import { countUse } from './usage'
import { useUsageReport } from './useUsageReport'

/**
 * A finished day goes to the server once: the server adds what it is sent to
 * the day's totals, so a day sent twice counts twice.
 */

const mockPrefs = new Map<string, string>()
jest.mock('../../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mockPrefs.get(key) ?? null,
    set: (key: string, value: string) => mockPrefs.set(key, value),
  },
}))
let mockApi: { reportUsage: (report: UsageReport) => Promise<void> } | null = null
jest.mock('../../connection/useServerApi', () => ({ useServerApi: () => ({ api: mockApi }) }))

it('sends a day once, though the server is reached anew while it goes', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-10-22T20:00:00Z') })
  countUse('search')
  jest.setSystemTime(Date.parse('2026-10-23T09:00:00Z'))

  const sent: string[] = []
  let arrive = (): void => undefined
  const reportUsage = (report: UsageReport): Promise<void> => {
    sent.push(report.day)
    return new Promise(resolve => (arrive = resolve))
  }
  mockApi = { reportUsage }
  const view = await renderHook(() => useUsageReport())
  // The same server, reached again before the first send has landed.
  mockApi = { reportUsage }
  await view.rerender({})
  await act(async () => arrive())
  await act(async () => arrive())

  expect(sent).toEqual(['2026-10-22'])
  jest.useRealTimers()
})
