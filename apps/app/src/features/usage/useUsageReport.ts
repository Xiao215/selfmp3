import { useEffect } from 'react'
import { useServerApi } from '../../connection/useServerApi'
import { pendingReports, sentReport, useUsageCounting } from './usage'

/** How often a device looks for a finished day to send, while it is open. */
const LOOK_EVERY_MS = 60 * 60 * 1000

/**
 * Sends the days this device counted (usage.ts) to its library's server, once
 * each, the day after: today's counts go tomorrow. Nothing is sent while
 * counting is off, or while no server answers; the days wait, a week at most.
 */
export function useUsageReport(): void {
  const counting = useUsageCounting()
  const { api } = useServerApi()

  useEffect(() => {
    if (!counting || !api) return
    let stopped = false
    const send = async (): Promise<void> => {
      for (const report of pendingReports()) {
        if (stopped) return
        try {
          await api.reportUsage(report)
          sentReport(report.day)
        } catch {
          // The server away, or refusing for now: the day waits for the next look.
          return
        }
      }
    }
    void send()
    const timer = setInterval(() => void send(), LOOK_EVERY_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [counting, api])
}
