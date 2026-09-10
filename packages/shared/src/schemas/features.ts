import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Audio features, computed locally from the file itself.
 *
 * Every value is nullable because analysis is best-effort: a track that is
 * mostly silence has no meaningful BPM, and a spoken-word file has no key.
 * A null says "we looked and found nothing" — distinct from the song having
 * no `features` row at all, which means "not analysed yet".
 */

/** A Camelot wheel code: 1–12 followed by A (minor) or B (major). */
export const CamelotSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(1[0-2]|[1-9])[AB]$/, 'not a Camelot code')

export const SongFeaturesSchema = z.object({
  bpm: z.number().positive().nullable(),
  /** 0–1. Perceived intensity: a blend of loudness and rhythmic activity. */
  energy: z.number().min(0).max(1).nullable(),
  /** Integrated loudness in LUFS (EBU R128). Typically -30 to -5. */
  loudnessLufs: z.number().nullable(),
  /** Human name, e.g. "A minor". */
  key: z.string().nullable(),
  camelot: CamelotSchema.nullable(),
  /** 0–1. How regular the beat is; steady four-on-the-floor scores high. */
  danceability: z.number().min(0).max(1).nullable(),
  analyzedAt: z.string(),
  /** Bumped when the algorithm changes, so old rows get re-analysed. */
  version: z.number().int().nonnegative(),
})
export type SongFeatures = z.infer<typeof SongFeaturesSchema>

/** Progress of the background analyser. */
export const AnalysisStatusSchema = z.object({
  running: z.boolean(),
  /** Songs still waiting for analysis. */
  pending: z.number().int().nonnegative(),
  /** Songs analysed since this run started. */
  done: z.number().int().nonnegative(),
  /** Songs that failed in this run. */
  failed: z.number().int().nonnegative(),
  current: z.object({ id: IdSchema, title: z.string() }).nullable(),
})
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>
