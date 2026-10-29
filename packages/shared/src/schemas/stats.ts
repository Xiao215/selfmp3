import { z } from 'zod'
import { IdSchema } from './common.js'
import { CameWithSchema } from './song.js'

/**
 * Listening statistics.
 *
 * Every number here is derived from the `play_events` table rather than a
 * running counter, so a stat can be recomputed or reinterpreted later without
 * having lost the underlying data.
 */

export const StatsRangeSchema = z.enum(['7d', '30d', '90d', '365d', 'all'])
export type StatsRange = z.infer<typeof StatsRangeSchema>

/**
 * The reader's time zone as an IANA name (`Asia/Shanghai`), sent with Stats,
 * Wrapped and the usual hours so days and hours are counted where the reader
 * is, not where the server is (`readerZone` on the server; `readerTimeZone` here).
 */
export const ZoneQuerySchema = z.string().max(64).optional()

export const DailyPlaysSchema = z.object({
  /** YYYY-MM-DD in the reader's time zone. */
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

/**
 * One song's history with you, `/api/songs/:id/history`: every play of it the
 * server keeps, folded into what its page draws. The server is the only one
 * that has them all; a device's own copy knows only the count and the last.
 */
export const SongHistorySchema = z.object({
  songId: IdSchema,
  /** Who handed it over, when someone did (schemas/song.ts). */
  cameWith: CameWithSchema.nullable(),
  plays: z.number().int().nonnegative(),
  /** Everything heard of it, all plays together. */
  msPlayed: z.number().int().nonnegative(),
  /** UTC `YYYY-MM-DD HH:MM:SS`, as every play time is; null before any play. */
  firstPlayedAt: z.string().nullable(),
  lastPlayedAt: z.string().nullable(),
  /**
   * Plays by the UTC hour they began in, oldest first, only hours that have
   * any: the device folds them into its own weeks, in its own time zone.
   */
  hours: z.array(
    z.object({
      /** UTC `YYYY-MM-DD HH:00:00`. */
      at: z.string(),
      plays: z.number().int().positive(),
    }),
  ),
})
export type SongHistory = z.infer<typeof SongHistorySchema>

/**
 * What you usually play at each hour, `/api/stats/usual` (Home's hour tile,
 * docs/features/wrapped-and-gems.md, "Usually at this hour"). For each kind of
 * day and each local hour, 0 to 23, the songs most played around it lately,
 * most first, as places in `songs`: a song named once, however many hours it
 * is in, so a device can keep the whole answer and play it with no server.
 * An hour with too little history is an empty list.
 */
export const UsualHoursSchema = z.object({
  /** The songs' uids, which a device lines up with its own songs. */
  songs: z.array(z.string()),
  weekday: z.array(z.array(z.number().int().nonnegative())).length(24),
  weekend: z.array(z.array(z.number().int().nonnegative())).length(24),
})
export type UsualHours = z.infer<typeof UsualHoursSchema>
