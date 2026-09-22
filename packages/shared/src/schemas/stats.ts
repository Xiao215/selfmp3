import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Listening statistics.
 *
 * Every number here is derived from the `play_events` table rather than a
 * running counter, so a stat can be recomputed or reinterpreted later without
 * having lost the underlying data.
 */

export const StatsRangeSchema = z.enum(['7d', '30d', '90d', '365d', 'all'])
export type StatsRange = z.infer<typeof StatsRangeSchema>

export const DailyPlaysSchema = z.object({
  /** YYYY-MM-DD in local server time. */
  date: z.string(),
  plays: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
})
export type DailyPlays = z.infer<typeof DailyPlaysSchema>

export const HourlyPlaysSchema = z.object({
  hour: z.number().int().min(0).max(23),
  plays: z.number().int().nonnegative(),
})
export type HourlyPlays = z.infer<typeof HourlyPlaysSchema>

export const TopEntrySchema = z.object({
  key: z.string(),
  plays: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
})
export type TopEntry = z.infer<typeof TopEntrySchema>

export const TopSongSchema = z.object({
  songId: IdSchema,
  title: z.string(),
  artist: z.string(),
  hasArt: z.boolean(),
  plays: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
})
export type TopSong = z.infer<typeof TopSongSchema>

export const StatsSchema = z.object({
  range: StatsRangeSchema,
  totals: z.object({
    plays: z.number().int().nonnegative(),
    minutes: z.number().nonnegative(),
    songsPlayed: z.number().int().nonnegative(),
    librarySize: z.number().int().nonnegative(),
    libraryMinutes: z.number().nonnegative(),
    /** Songs in the library that have never been played once. */
    neverPlayed: z.number().int().nonnegative(),
  }),
  /** Consecutive days with at least one play, counting back from today. */
  streakDays: z.number().int().nonnegative(),
  longestStreakDays: z.number().int().nonnegative(),
  daily: z.array(DailyPlaysSchema),
  hourly: z.array(HourlyPlaysSchema),
  topArtists: z.array(TopEntrySchema),
  topTags: z.array(TopEntrySchema),
  topSongs: z.array(TopSongSchema),
})
export type Stats = z.infer<typeof StatsSchema>
