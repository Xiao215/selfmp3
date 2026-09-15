import { z } from 'zod'
import { IdSchema } from './common.js'
import { TopEntrySchema, TopSongSchema } from './stats.js'

/**
 * "Wrapped, anytime": a year-in-review style summary for any window.
 *
 * Everything is computed from `play_events`, like the rest of the stats. The
 * ranges are rolling windows counted back from today rather than calendar
 * periods, so "week" on a Tuesday is still seven days of listening — but they
 * start at a local midnight, because every headline here is a count of days
 * and a window straddling eight dates would contradict its own label.
 */

/**
 * `quarter` is three months, counted as ninety days: Stats offers the same
 * window, and the two pages share one range control.
 */
export const WrappedRangeSchema = z.enum(['week', 'month', 'quarter', 'year', 'all'])
export type WrappedRange = z.infer<typeof WrappedRangeSchema>

export const WRAPPED_RANGE_LABELS: Record<WrappedRange, string> = {
  week: 'Last 7 days',
  month: 'Last 30 days',
  quarter: 'Last 3 months',
  year: 'Last 12 months',
  all: 'All time',
}

export const WRAPPED_RANGE_DAYS: Record<WrappedRange, number | null> = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
  all: null,
}

/** One song's plays on the single day you played it most. */
export const WrappedDayRecordSchema = z.object({
  songId: IdSchema,
  title: z.string(),
  artist: z.string(),
  hasArt: z.boolean(),
  /** YYYY-MM-DD, local server time. */
  date: z.string(),
  plays: z.number().int().positive(),
})
export type WrappedDayRecord = z.infer<typeof WrappedDayRecordSchema>

/** The traits a listening pattern can earn. Fixed vocabulary, honest rules. */
export const PersonalityTraitSchema = z.enum([
  'Night owl',
  'Early bird',
  'Daytime listener',
  'Repeat listener',
  'Explorer',
  'Collector',
  'Daily ritual',
  'Weekender',
  'Marathoner',
  'Casual listener',
])
export type PersonalityTrait = z.infer<typeof PersonalityTraitSchema>

export const WrappedSchema = z.object({
  range: WrappedRangeSchema,
  /** ISO timestamps bounding the window; `from` is null for all time. */
  from: z.string().nullable(),
  to: z.string(),
  totals: z.object({
    plays: z.number().int().nonnegative(),
    minutes: z.number().nonnegative(),
    songsPlayed: z.number().int().nonnegative(),
    /** Distinct local dates with at least one play. */
    activeDays: z.number().int().nonnegative(),
  }),
  topSongs: z.array(TopSongSchema).max(5),
  topArtists: z.array(TopEntrySchema).max(5),
  topTags: z.array(TopEntrySchema).max(5),
  /** Hour of day (local) with the most plays, or null with no plays. */
  peakHour: z.object({ hour: z.number().int().min(0).max(23), plays: z.number().int() }).nullable(),
  /** Day of week (0 = Sunday) with the most plays. */
  peakWeekday: z
    .object({ weekday: z.number().int().min(0).max(6), plays: z.number().int() })
    .nullable(),
  /** The single busiest date in the window. */
  busiestDate: z.object({ date: z.string(), plays: z.number().int() }).nullable(),
  /** Longest run of consecutive days with a play, inside the window. */
  longestStreakDays: z.number().int().nonnegative(),
  mostInOneDay: WrappedDayRecordSchema.nullable(),
  /** Added during the window and played at least three times in it. */
  discovered: z.array(TopSongSchema),
  personality: z.object({
    traits: z.array(PersonalityTraitSchema),
    /** The traits joined for display: "Night owl · Repeat listener". */
    line: z.string(),
  }),
})
export type Wrapped = z.infer<typeof WrappedSchema>
