import { useUsageReport } from './useUsageReport'

/** Drawn as nothing, at the root: sends the finished days (useUsageReport). */
export function UsageReporter(): null {
  useUsageReport()
  return null
}
