import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Smart features (docs/features/ai.md): what a device asks the server and what
 * comes back.
 *
 * Songs travel as the server's ids, like the stats, and the device lines them
 * up with its own (`useServerSongIds`). Tags travel by name: a name is unique
 * in every library, case aside, so it means the same tag on both sides without
 * a translation of its own.
 */

/** A bound of a 0–1 or bpm range; either end may be open. */
export const RangeSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
})
export type Range = z.infer<typeof RangeSchema>

/**
 * What a description was understood as, in parts a person can see and take
 * away one at a time.
 *
 * Places widen and everything else narrows (the rule from combining tags):
 * a song is in if it carries any of `anyTags` or is by any of `artists` (or
 * there are neither), and then passes every other part that is set.
 */
export const UnderstandingSchema = z.object({
  /** A name for the playlist, from the words. */
  name: z.string().trim().min(1).max(60),
  anyTags: z.array(z.string()).max(12),
  artists: z.array(z.string()).max(12),
  noTags: z.array(z.string()).max(12),
  /** 0–1, from the audio analysis. A song not analysed yet does not pass a set range. */
  energy: RangeSchema,
  bpm: RangeSchema,
  /** With words, without (instrumental, or no lyrics found), or either. */
  words: z.enum(['with', 'without']).nullable(),
  loved: z.boolean().nullable(),
  /** Only songs played within this many days. */
  playedWithinDays: z.number().int().min(1).max(3650).nullable(),
  /** Leave out songs played within this many days; never played stays in. */
  notPlayedWithinDays: z.number().int().min(1).max(3650).nullable(),
  addedWithinDays: z.number().int().min(1).max(3650).nullable(),
  /** How many songs were asked for, when the words said. */
  size: z.number().int().min(1).max(200).nullable(),
  /**
   * What the words want that the parts above cannot say: "for reading", "sounds
   * like rain". Null when the parts say all of it.
   */
  brief: z.string().max(200).nullable(),
})
export type Understanding = z.infer<typeof UnderstandingSchema>

export const DescribeRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  /**
   * Given when the parts were changed on the device: the words are not read
   * again, the songs are only picked again from what the parts now let in.
   */
  understanding: UnderstandingSchema.nullable().default(null),
})
export type DescribeRequest = z.infer<typeof DescribeRequestSchema>

export const DescribePickSchema = z.object({
  songId: IdSchema,
  /** A few words on why it fits; null when every song that fit was taken. */
  why: z.string().nullable(),
})
export type DescribePick = z.infer<typeof DescribePickSchema>

export const DescribeResultSchema = z.object({
  understanding: UnderstandingSchema,
  /** How many songs the parts let in, before any picking. */
  fit: z.number().int().nonnegative(),
  /** Parts taken away because together they let nothing in, in plain words. */
  loosened: z.array(z.string()),
  /** Tags or artists the words named that this library does not have. */
  unknown: z.array(z.string()),
  picks: z.array(DescribePickSchema),
})
export type DescribeResult = z.infer<typeof DescribeResultSchema>

export const TagSuggestionSchema = z.object({
  /** An existing tag's name, or the name of a tag that would be made. */
  tag: z.string(),
  isNew: z.boolean(),
  songIds: z.array(IdSchema).min(1),
  /** Who the songs are by, shortest first: "周杰倫 76, 薛之谦 12, +8 more". */
  who: z.string(),
  why: z.string(),
  /** Read off the library's own tagging, or judged by the model. */
  from: z.enum(['library', 'model']),
})
export type TagSuggestion = z.infer<typeof TagSuggestionSchema>

export const TagSuggestionsSchema = z.object({
  /** Songs without a tag when this was worked out. */
  untagged: z.number().int().nonnegative(),
  suggestions: z.array(TagSuggestionSchema),
  /** Songs it would not guess for, and why. */
  unsure: z.array(z.object({ songIds: z.array(IdSchema), who: z.string(), why: z.string() })),
})
export type TagSuggestions = z.infer<typeof TagSuggestionsSchema>
