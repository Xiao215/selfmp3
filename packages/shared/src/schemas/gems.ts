import { z } from 'zod'
import { SongSchema } from './song.js'

/**
 * Forgotten gems: songs you clearly liked — loved, or played a lot — that
 * have not come up in a long while. The list rotates a little on every
 * request so it stays a discovery rather than a fixed chore.
 */
export const ForgottenGemsSchema = z.object({
  songs: z.array(SongSchema),
  /** How long a song must have gone unplayed to qualify, in days. */
  minDays: z.number().int().positive(),
  /** How many songs qualified in total, before the limit. */
  total: z.number().int().nonnegative(),
  generatedAt: z.string(),
})
export type ForgottenGems = z.infer<typeof ForgottenGemsSchema>

/** Never look further back than this: two months without a play is "forgotten". */
export const GEMS_MAX_DAYS = 60
/** A library only two weeks old cannot have forgotten anything yet. */
export const GEMS_MIN_DAYS = 14

/**
 * The gap that counts as "a long time", scaled to how old the library is.
 *
 * A fixed 60 days would leave a six-week-old library with nothing to show, so
 * the threshold is a fifth of the library's age, clamped to 14–60 days.
 */
export function gemsThresholdDays(libraryAgeDays: number): number {
  const scaled = Math.round(Math.max(0, libraryAgeDays) / 5)
  return Math.max(GEMS_MIN_DAYS, Math.min(GEMS_MAX_DAYS, scaled))
}
