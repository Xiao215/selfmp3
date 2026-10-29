import {
  USAGE_ERRORS,
  USAGE_FEATURES,
  USAGE_MAX_PER_DAY,
  type UsageError,
  type UsageFeature,
  type UsageReport,
} from '@selfmp3/shared'
import { prefs } from '../../ports/prefs'

/**
 * What this device counts for its server owner's admin page
 * (docs/features/admin.md): how many times each feature was used today, and
 * which problems it showed. Names only, never what was played, searched or
 * asked. Kept on the device a day at a time, sent once a day (useUsageReport).
 */

const COUNTS_KEY = 'usageCounts'
/** A day not sent within a week is let go: the server would not take it any more. */
const DAYS_KEPT = 7

type Counts = Record<string, UsageReport>

/** Today, as the server counts days: in UTC. */
function usageDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

function read(): Counts {
  try {
    const parsed: unknown = JSON.parse(prefs.get(COUNTS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Counts) : {}
  } catch {
    return {}
  }
}

function bump(kind: 'uses' | 'errors', name: string): void {
  const counts = read()
  const day = usageDay()
  const today = counts[day] ?? { day, uses: {}, errors: {} }
  const bag = today[kind] as Record<string, number>
  bag[name] = Math.min((bag[name] ?? 0) + 1, USAGE_MAX_PER_DAY)
  counts[day] = today
  prefs.set(COUNTS_KEY, JSON.stringify(counts))
}

/** One use of a feature, today. */
export function countUse(feature: UsageFeature): void {
  bump('uses', feature)
}

/** One problem shown to the person holding this device, today. */
export function countShownError(code: UsageError): void {
  bump('errors', code)
}

/**
 * The days ready to send: every day before today with something in it, the
 * names checked against the lists the server takes. Days older than a week
 * are dropped as they are found.
 */
export function pendingReports(now = Date.now()): UsageReport[] {
  const counts = read()
  const today = usageDay(now)
  const oldest = usageDay(now - DAYS_KEPT * 24 * 60 * 60 * 1000)
  const ready: UsageReport[] = []
  let dropped = false
  for (const [day, report] of Object.entries(counts)) {
    if (day < oldest) {
      delete counts[day]
      dropped = true
      continue
    }
    if (day >= today) continue
    const uses = pick(report.uses, USAGE_FEATURES)
    const errors = pick(report.errors, USAGE_ERRORS)
    if (Object.keys(uses).length + Object.keys(errors).length > 0) ready.push({ day, uses, errors })
  }
  if (dropped) prefs.set(COUNTS_KEY, JSON.stringify(counts))
  return ready.sort((a, b) => a.day.localeCompare(b.day))
}

/** Forget a day once the server has it. */
export function sentReport(day: string): void {
  const counts = read()
  delete counts[day]
  prefs.set(COUNTS_KEY, JSON.stringify(counts))
}

function pick<Name extends string>(
  bag: Partial<Record<string, number>> | undefined,
  names: readonly Name[],
): Partial<Record<Name, number>> {
  const kept: Partial<Record<Name, number>> = {}
  for (const name of names) {
    const n = bag?.[name]
    if (typeof n === 'number' && n > 0) kept[name] = Math.min(Math.round(n), USAGE_MAX_PER_DAY)
  }
  return kept
}
