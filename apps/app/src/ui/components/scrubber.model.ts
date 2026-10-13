import { clamp01 } from '@selfmp3/shared'

/**
 * A scrubber's arithmetic (`Scrubber`), with nothing drawn: how far along the
 * track a value sits, and which value a point on the track means.
 */

/**
 * How far along the track is filled, in tenths of a per cent (0 to 1000).
 * Nothing while the end is unknown.
 *
 * Rounded, because on the web every distinct value written into a style is
 * its own atomic CSS rule (`ProgressWash.tsx` explains this at length): an
 * unrounded share from a position that ticks several times a second is a new
 * rule every tick, for the length of every song. A tenth still moves the fill
 * about a point and a half a tick, as often as the thumb itself moves, and
 * there are only a thousand such values, reused by every song.
 */
export function filledTenths(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0
  return Math.round(clamp01(value / max) * 1000)
}

/**
 * The value a point `along` a track `length` long means, kept within 0 and
 * `max`; null for a track not measured yet, or with no end to reach.
 */
export function valueAlong(along: number, length: number, max: number): number | null {
  if (!(length > 0) || !(max > 0)) return null
  return clamp01(along / length) * max
}
