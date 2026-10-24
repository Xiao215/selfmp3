import { z } from 'zod'
import type { ImportStep } from './import.js'

/**
 * The owner's admin page (docs/features/admin.md): what a server counts, and
 * what its devices tell it. Totals only: nothing here names a library or a
 * person, so nothing can be broken down by one later.
 */

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * The features a device counts, once a day, while its owner leaves "Count
 * features I use" on (Settings › About). A name is the feature as people know
 * it, never what was played, searched or asked.
 */
export const USAGE_FEATURES = [
  'now-playing',
  'search',
  'lyrics',
  'import',
  'ask',
  'up-next',
  'share-link',
  'room',
] as const
export type UsageFeature = (typeof USAGE_FEATURES)[number]

/** Problems a device showed someone, by the same names it counts features under. */
export const USAGE_ERRORS = ['cloud-unreachable', 'server-away', 'bucket-full'] as const
export type UsageError = (typeof USAGE_ERRORS)[number]

/** The most one device may say a feature was used in a day: past it, a count is noise. */
export const USAGE_MAX_PER_DAY = 10_000

const CountSchema = z.number().int().nonnegative().max(USAGE_MAX_PER_DAY)

/**
 * `POST /api/usage`: one device's counts for one day. The server adds them to
 * that day's totals and keeps nothing else, not even which library sent them.
 */
export const UsageReportSchema = z.object({
  day: DaySchema,
  uses: z.record(z.enum(USAGE_FEATURES), CountSchema),
  errors: z.record(z.enum(USAGE_ERRORS), CountSchema),
})
export type UsageReport = z.infer<typeof UsageReportSchema>

/** Where an import came from, as its address says. */
export const IMPORT_ORIGINS = ['youtube', 'youtube-music', 'netease', 'spotify', 'other'] as const
export type ImportOrigin = (typeof IMPORT_ORIGINS)[number]

/** Why an import failed, in groups a person can act on. */
export const IMPORT_FAILURES = [
  'youtube-blocked',
  'unavailable',
  'no-match',
  'bucket',
  'timeout',
  'other',
] as const
export type ImportFailure = (typeof IMPORT_FAILURES)[number]

/** The steps an import's time is split into, in order. */
export const TIMED_IMPORT_STEPS = [
  'waiting',
  'resolving',
  'downloading',
  'converting',
  'lyrics',
  'saving',
  'uploading',
] as const satisfies readonly ImportStep[]

/** Bands of time an import took, as the admin page draws them: the upper bound of each, in ms. */
export const IMPORT_TIME_BANDS_MS = [30_000, 60_000, 120_000, 180_000, 300_000, 600_000] as const

const DayCountSchema = z.object({ day: DaySchema, count: z.number().int().nonnegative() })

/** `GET /api/admin/data?days=N`, on the admin listener only. */
export const AdminDataSchema = z.object({
  /** The window, as UTC dates, both ends included. */
  from: DaySchema,
  to: DaySchema,
  imports: z.object({
    byDay: z.array(z.object({ day: DaySchema, done: z.number().int(), failed: z.number().int() })),
    /** The same counts for the window before, for "on the days before". */
    before: z.object({ done: z.number().int(), failed: z.number().int() }),
    /** Imports that worked, by band: one more entry than `IMPORT_TIME_BANDS_MS`, the last open-ended. */
    bands: z.array(z.number().int()),
    medianMs: z.number().int().nullable(),
    p90Ms: z.number().int().nullable(),
    /** Median ms of each step, over imports that worked. */
    steps: z.array(z.object({ step: z.enum(TIMED_IMPORT_STEPS), medianMs: z.number().int() })),
    failures: z.array(z.object({ kind: z.enum(IMPORT_FAILURES), count: z.number().int() })),
    sources: z.array(
      z.object({
        source: z.enum(IMPORT_ORIGINS),
        done: z.number().int(),
        failed: z.number().int(),
        medianMs: z.number().int().nullable(),
      }),
    ),
    /** YouTube and YouTube Music imports only, worked and failed by day. */
    youtube: z.array(
      z.object({ day: DaySchema, done: z.number().int(), failed: z.number().int() }),
    ),
    /** Times YouTube asked the server to slow down, by day. */
    held: z.array(DayCountSchema),
    /** Imports that worked only after a retry. */
    retried: z.number().int(),
  }),
  /** Plays across every library here, by day. */
  plays: z.array(DayCountSchema),
  smart: z.object({
    byFeature: z.array(z.object({ feature: z.string(), count: z.number().int() })),
    failed: z.number().int(),
    averageMs: z.number().int().nullable(),
  }),
  usage: z.array(z.object({ feature: z.enum(USAGE_FEATURES), count: z.number().int() })),
  errors: z.array(
    z.object({
      /** `server` for a 500 the server answered, `app` for a problem a device showed. */
      from: z.enum(['server', 'app']),
      name: z.string(),
      count: z.number().int(),
      lastDay: DaySchema,
    }),
  ),
})
export type AdminData = z.infer<typeof AdminDataSchema>

/** `GET /api/admin/server`, on the admin listener only. */
export const AdminServerSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number().int(),
  libraries: z.number().int(),
  disk: z.object({ freeBytes: z.number(), totalBytes: z.number() }).nullable(),
  memory: z.object({ usedBytes: z.number(), totalBytes: z.number() }),
  smart: z.enum(['answering', 'not-answering', 'off']),
  youtube: z.object({
    /** When the server may ask YouTube again, if it is holding off now. */
    heldUntil: z.string().nullable(),
    /** When YouTube last asked it to slow down. */
    lastHeldAt: z.string().nullable(),
  }),
  /**
   * Where the page signs in and asks the doorman, with the paths it asks by
   * (packages/shared's `DOORMAN_PATHS`, so the page never spells one itself).
   * Null: this server has no doorman.
   */
  doorman: z
    .object({
      url: z.string(),
      paths: z.object({
        claim: z.string(),
        me: z.string(),
        access: z.string(),
        accessRequests: z.string(),
        stats: z.string(),
      }),
    })
    .nullable(),
})
export type AdminServer = z.infer<typeof AdminServerSchema>

/** `GET /api/admin/signin?attempt=…`: where to send the browser to sign in to the doorman. */
export const AdminSignInSchema = z.object({ url: z.string() })
export type AdminSignIn = z.infer<typeof AdminSignInSchema>
