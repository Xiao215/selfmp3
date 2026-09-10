import type { PersonalityTrait } from './schemas/wrapped.js'

/**
 * The "listening personality" line on the Wrapped card.
 *
 * Every trait is a plain threshold on numbers the stats already compute, and
 * every threshold is written down here. The point is that the line is honest:
 * "Night owl" means more than a third of your plays were after ten at night,
 * not that a model thought you seemed nocturnal.
 */

export interface PersonalityInput {
  /** Total plays in the window. */
  readonly plays: number
  /** Distinct songs played in the window. */
  readonly songsPlayed: number
  /** Plays per local hour, 24 entries. */
  readonly hourly: readonly number[]
  /** Plays per local weekday, 7 entries, 0 = Sunday. */
  readonly weekday: readonly number[]
  /** Plays of the five most-played songs, summed. */
  readonly topFivePlays: number
  /** Songs added in the window and played three or more times. */
  readonly discovered: number
  /** Longest run of consecutive days with a play, inside the window. */
  readonly longestStreakDays: number
  /** Minutes listened in the window. */
  readonly minutes: number
  /** Distinct days with at least one play. */
  readonly activeDays: number
}

/** Fewer plays than this and no pattern is worth claiming. */
export const PERSONALITY_MIN_PLAYS = 10

/** Share of plays needed to call a time of day yours. */
const TIME_SHARE = 0.35
/** Top five songs making up this share of plays is "on repeat". */
const REPEAT_SHARE = 0.4
/** Distinct songs per play above this is "always something new". */
const EXPLORER_RATIO = 0.6
const COLLECTOR_DISCOVERIES = 3
const RITUAL_STREAK_DAYS = 7
/** Saturday and Sunday are two of seven days; this is well above their share. */
const WEEKEND_SHARE = 0.45
/** Two hours a day on the days you listen at all. */
const MARATHON_MINUTES_PER_ACTIVE_DAY = 120

export function listeningPersonality(input: PersonalityInput): PersonalityTrait[] {
  if (input.plays < PERSONALITY_MIN_PLAYS) return ['Casual listener']

  const traits: PersonalityTrait[] = []
  const share = (count: number): number => (input.plays > 0 ? count / input.plays : 0)

  // Time of day. 22:00–04:59 is night; 05:00–09:59 is early; the middle of
  // the day only earns a trait when it is clearly dominant.
  const night = sumHours(input.hourly, [22, 23, 0, 1, 2, 3, 4])
  const early = sumHours(input.hourly, [5, 6, 7, 8, 9])
  const day = sumHours(input.hourly, [10, 11, 12, 13, 14, 15, 16, 17])
  if (share(night) >= TIME_SHARE) traits.push('Night owl')
  else if (share(early) >= TIME_SHARE) traits.push('Early bird')
  else if (share(day) >= 0.6) traits.push('Daytime listener')

  // Breadth versus depth. Both can be true of a big enough library, but the
  // thresholds are set so that one usually wins.
  if (share(input.topFivePlays) >= REPEAT_SHARE) traits.push('Repeat listener')
  if (input.songsPlayed / input.plays >= EXPLORER_RATIO) traits.push('Explorer')
  else if (input.discovered >= COLLECTOR_DISCOVERIES) traits.push('Collector')

  // Habit.
  if (input.longestStreakDays >= RITUAL_STREAK_DAYS) traits.push('Daily ritual')
  const weekend = (input.weekday[0] ?? 0) + (input.weekday[6] ?? 0)
  if (share(weekend) >= WEEKEND_SHARE) traits.push('Weekender')

  // Volume.
  if (input.activeDays > 0 && input.minutes / input.activeDays >= MARATHON_MINUTES_PER_ACTIVE_DAY) {
    traits.push('Marathoner')
  }

  return traits.length > 0 ? traits : ['Casual listener']
}

export function personalityLine(traits: readonly PersonalityTrait[]): string {
  return traits.join(' · ')
}

function sumHours(hourly: readonly number[], hours: readonly number[]): number {
  let total = 0
  for (const hour of hours) total += hourly[hour] ?? 0
  return total
}
