import { z } from 'zod'

/**
 * What a song does over time, coarsely: how loud it is and where the hits are,
 * twenty times a second, for the whole song.
 *
 * Made by the server when it analyses a song (`apps/server/src/services/dsp.ts`)
 * and played back against the playhead by Now Playing's visuals wherever the
 * browser's live analyser cannot listen — the phone, Safari, a cloud library,
 * offline. Two bytes a frame, base64 in JSON: a four-minute song is about
 * 13 KB, small enough to keep beside every downloaded song.
 *
 * Bytes rather than numbers because a JSON array of 4800 floats is five times
 * the size and says nothing more at the resolution a picture can show.
 */

/** Bump when the curve is computed differently enough that old files should be redone. */
export const MOTION_VERSION = 1

/** Frames per second in a motion file. */
export const MOTION_RATE = 20

export const MotionSchema = z.object({
  /** `MOTION_VERSION` when it was written. */
  version: z.number().int(),
  /** Frames per second: `MOTION_RATE`. */
  rate: z.number().positive(),
  /** Seconds covered. */
  duration: z.number().nonnegative(),
  /**
   * Base64 of one byte per frame: short-term RMS in dB, mapped linearly from
   * -60 dBFS (0) to 0 dBFS (255), clamped.
   */
  loudness: z.string(),
  /**
   * Base64 of one byte per frame: spectral-flux onset strength, the strongest
   * in the frame, with the song's 98th percentile at 255, clamped. Beats and
   * hits are the peaks.
   */
  onset: z.string(),
})
export type Motion = z.infer<typeof MotionSchema>
