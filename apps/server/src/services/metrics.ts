import {
  DAY_MS,
  IMPORT_FAILURES,
  IMPORT_ORIGINS,
  IMPORT_TIME_BANDS_MS,
  TIMED_IMPORT_STEPS,
  USAGE_FEATURES,
  type AdminData,
  type ImportFailure,
  type ImportOrigin,
  type UsageReport,
} from '@selfmp3/shared'
import type { ImportLogRow, MetricsRepository } from '../repositories/metrics.js'

/**
 * What this server counts for its owner's admin page (docs/features/admin.md),
 * kept in `metrics.db` beside hub.json (repositories/metrics.ts): a row per
 * finished import, and a count per day and name — Smart requests, YouTube
 * asking the server to slow down, 500s, and what devices report.
 *
 * Totals only, so nothing here can be broken down by person later. Both are
 * kept a year (`DAYS_KEPT`), let go once a day.
 *
 * Counting is never worth an answer or the server: a write that fails — the
 * disk full, the file held — is handed to `onFailure` and dropped. The 500s
 * are counted from a response's `finish` event, where a throw is uncaught,
 * and a full disk's first 500 took the whole server down with it.
 */

/** A year, and a little more, so a year back always has its first week. */
const DAYS_KEPT = 400

export type TimedStep = (typeof TIMED_IMPORT_STEPS)[number]

export interface FinishedImport {
  readonly finishedAt: Date
  readonly url: string
  readonly worked: boolean
  /** Why it failed, from its message (`failureOf`); null when it worked. */
  readonly failure: ImportFailure | null
  /** How long each step took, in ms; steps it never reached are left out. */
  readonly steps: Partial<Record<TimedStep, number>>
  readonly attempts: number
}

/** The names daily totals are kept under. */
export const METRIC = {
  smart: (feature: string): string => `smart.${feature}`,
  smartFailed: 'smart.failed',
  smartMs: 'smart.ms',
  youtubeHeld: 'youtube.held',
  serverError: (route: string): string => `error.${route}`,
  use: (feature: string): string => `usage.${feature}`,
  appError: (code: string): string => `apperror.${code}`,
} as const

export class ServerMetrics {
  readonly #repo: MetricsRepository
  readonly #now: () => number
  readonly #onFailure: (error: unknown) => void
  #prunedDay = ''

  constructor(
    repo: MetricsRepository,
    now: () => number = () => Date.now(),
    onFailure: (error: unknown) => void = () => undefined,
  ) {
    this.#repo = repo
    this.#now = now
    this.#onFailure = onFailure
  }

  recordImport(finished: FinishedImport): void {
    const total = Object.values(finished.steps).reduce((sum, ms) => sum + ms, 0)
    this.#write(() => {
      this.#repo.insertImport({
        day: utcDay(finished.finishedAt.getTime()),
        finished_at: finished.finishedAt.toISOString(),
        source: sourceOf(finished.url),
        worked: finished.worked ? 1 : 0,
        failure: finished.worked ? null : (finished.failure ?? 'other'),
        total_ms: Math.round(total),
        steps: JSON.stringify(finished.steps),
        attempts: finished.attempts,
      })
      this.#prune()
    })
  }

  /** Add to today's totals. */
  count(name: string, by = 1): void {
    this.add(utcDay(this.#now()), { [name]: by })
  }

  /** Add to a day's totals, several names at once. */
  add(day: string, counts: Readonly<Record<string, number>>): void {
    this.#write(() => {
      this.#repo.addTotals(day, counts)
      this.#prune()
    })
  }

  /**
   * One device's day, added to the totals. A day in the future, or more than
   * a week back, is a device with a wrong clock: dropped rather than kept.
   */
  addReport(report: UsageReport): boolean {
    const today = utcDay(this.#now())
    if (report.day > today || report.day < utcDay(this.#now() - 7 * DAY_MS)) return false
    const counts: Record<string, number> = {}
    for (const [feature, n] of Object.entries(report.uses)) counts[METRIC.use(feature)] = n ?? 0
    for (const [code, n] of Object.entries(report.errors)) counts[METRIC.appError(code)] = n ?? 0
    this.add(report.day, counts)
    return true
  }

  /**
   * The admin page's numbers for the last `days` days, today included.
   * `plays` is every library's plays by day, which the libraries keep.
   */
  summary(
    days: number,
    plays: ReadonlyMap<string, number>,
  ): Omit<AdminData, 'doorman' | 'doormanProblem' | 'status'> {
    const to = utcDay(this.#now())
    const from = utcDay(this.#now() - (days - 1) * DAY_MS)
    const beforeFrom = utcDay(this.#now() - (2 * days - 1) * DAY_MS)
    const window = dayList(from, days)

    const rows = this.#repo.importsBetween(from, to)
    const before = this.#repo.importCountsBetween(beforeFrom, from)
    const totals = this.#repo.totalsBetween(from, to)

    const worked = rows.filter(row => row.worked === 1)
    const times = worked.map(row => row.total_ms).sort((a, b) => a - b)
    const bands = new Array<number>(IMPORT_TIME_BANDS_MS.length + 1).fill(0)
    for (const ms of times) {
      const band = IMPORT_TIME_BANDS_MS.findIndex(limit => ms < limit)
      const at = band === -1 ? IMPORT_TIME_BANDS_MS.length : band
      bands[at] = (bands[at] ?? 0) + 1
    }
    const stepTimes = new Map<TimedStep, number[]>()
    for (const row of worked) {
      for (const [step, ms] of Object.entries(parseSteps(row.steps))) {
        const list = stepTimes.get(step as TimedStep) ?? []
        list.push(ms)
        stepTimes.set(step as TimedStep, list)
      }
    }

    const byDay = (pick: (row: ImportLogRow) => boolean) =>
      window.map(day => {
        const today = rows.filter(row => row.day === day && pick(row))
        const done = today.filter(row => row.worked === 1).length
        return { day, done, failed: today.length - done }
      })
    const isYouTube = (row: ImportLogRow) =>
      row.source === 'youtube' || row.source === 'youtube-music'

    const named = (prefix: string) => {
      const found = new Map<string, number>()
      for (const row of totals) {
        if (!row.name.startsWith(prefix)) continue
        const name = row.name.slice(prefix.length)
        found.set(name, (found.get(name) ?? 0) + row.count)
      }
      return found
    }
    const total = (name: string) =>
      totals.filter(row => row.name === name).reduce((sum, row) => sum + row.count, 0)

    const smartByFeature = named('smart.')
    smartByFeature.delete('failed')
    smartByFeature.delete('ms')
    const smartCount = [...smartByFeature.values()].reduce((sum, n) => sum + n, 0)

    const errors: AdminData['errors'] = []
    for (const [prefix, from] of [
      ['error.', 'server'],
      ['apperror.', 'app'],
    ] as const) {
      const lastDay = new Map<string, string>()
      for (const row of totals) {
        if (!row.name.startsWith(prefix)) continue
        const name = row.name.slice(prefix.length)
        if ((lastDay.get(name) ?? '') < row.day) lastDay.set(name, row.day)
      }
      for (const [name, count] of named(prefix)) {
        errors.push({ from, name, count, lastDay: lastDay.get(name) ?? to })
      }
    }
    errors.sort((a, b) => b.count - a.count)

    const usage = named('usage.')
    return {
      from,
      to,
      imports: {
        byDay: byDay(() => true),
        before,
        bands,
        medianMs: quantile(times, 0.5),
        p90Ms: quantile(times, 0.9),
        steps: TIMED_IMPORT_STEPS.flatMap(step => {
          const list = (stepTimes.get(step) ?? []).sort((a, b) => a - b)
          const medianMs = quantile(list, 0.5)
          return medianMs === null ? [] : [{ step, medianMs }]
        }),
        failures: IMPORT_FAILURES.map(kind => ({
          kind,
          count: rows.filter(row => row.worked === 0 && row.failure === kind).length,
        })).filter(entry => entry.count > 0),
        sources: IMPORT_ORIGINS.map(source => {
          const from = rows.filter(row => row.source === source)
          const done = from.filter(row => row.worked === 1)
          return {
            source,
            done: done.length,
            failed: from.length - done.length,
            medianMs: quantile(
              done.map(row => row.total_ms).sort((a, b) => a - b),
              0.5,
            ),
          }
        }).filter(entry => entry.done + entry.failed > 0),
        youtube: byDay(isYouTube),
        held: window.map(day => ({
          day,
          count: totals.find(row => row.day === day && row.name === METRIC.youtubeHeld)?.count ?? 0,
        })),
        retried: worked.filter(row => row.attempts > 1).length,
        medianByDay: window.map(day => ({
          day,
          medianMs: quantile(
            worked
              .filter(row => row.day === day)
              .map(row => row.total_ms)
              .sort((a, b) => a - b),
            0.5,
          ),
        })),
      },
      plays: window.map(day => ({ day, count: plays.get(day) ?? 0 })),
      smart: {
        byFeature: [...smartByFeature]
          .map(([feature, count]) => ({ feature, count }))
          .sort((a, b) => b.count - a.count),
        failed: total(METRIC.smartFailed),
        averageMs: smartCount > 0 ? Math.round(total(METRIC.smartMs) / smartCount) : null,
      },
      usage: USAGE_FEATURES.map(feature => ({ feature, count: usage.get(feature) ?? 0 })).filter(
        entry => entry.count > 0,
      ),
      errors,
    }
  }

  /** A count written, or, when it cannot be, said and let go. */
  #write(write: () => void): void {
    try {
      write()
    } catch (error) {
      this.#onFailure(error)
    }
  }

  /** Once a day at most: rows older than a year go. */
  #prune(): void {
    const today = utcDay(this.#now())
    if (this.#prunedDay === today) return
    this.#prunedDay = today
    this.#repo.pruneBefore(utcDay(this.#now() - DAYS_KEPT * DAY_MS))
  }
}

/** Where an import came from, by its address's host. */
export function sourceOf(url: string): ImportOrigin {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (host === 'music.youtube.com') return 'youtube-music'
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'))
    return 'youtube'
  if (host === '163.com' || host.endsWith('.163.com') || host === '163cn.tv') return 'netease'
  if (host === 'spotify.com' || host.endsWith('.spotify.com') || host === 'spotify.link') {
    return 'spotify'
  }
  return 'other'
}

/**
 * Why an import failed, from the message the queue kept for it (the words a
 * person sees, after ytdlp.ts has explained YouTube's own).
 */
export function failureOf(message: string): ImportFailure {
  if (
    /not a bot|sign in to confirm|too many requests|\b429\b|rate.?limit|slow down/i.test(message)
  ) {
    return 'youtube-blocked'
  }
  // "only shows that to a signed-in account": a private or members-only video, as ytdlp.ts words it.
  if (
    /unavailable|private video|been removed|no longer available|copyright|not available|only shows that to a signed-in|age[- ]restricted|confirm your age/i.test(
      message,
    )
  ) {
    return 'unavailable'
  }
  if (/no match|couldn.t find|could not find|nothing (?:was )?found/i.test(message))
    return 'no-match'
  if (/timed? ?out|timeout/i.test(message)) return 'timeout'
  return 'other'
}

/** The day `ms` falls on in UTC, `2026-10-07`: the day the admin page and Backblaze both count by. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayList(from: string, days: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => utcDay(start + i * DAY_MS))
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return Math.round(sorted[at] ?? 0)
}

function parseSteps(text: string): Partial<Record<TimedStep, number>> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const steps: Partial<Record<TimedStep, number>> = {}
    for (const step of TIMED_IMPORT_STEPS) {
      const ms = parsed[step]
      if (typeof ms === 'number' && Number.isFinite(ms)) steps[step] = ms
    }
    return steps
  } catch {
    return {}
  }
}
