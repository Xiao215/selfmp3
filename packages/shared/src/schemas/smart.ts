import { z } from 'zod'
import { IdSchema, SongSortFieldSchema, SortDirectionSchema } from './common.js'
import { CamelotSchema } from './audioFeatures.js'

/**
 * Smart playlist rules.
 *
 * Each rule is a member of a union discriminated on `field`, so zod can say
 * which rule a bad one failed as, and the evaluators' switches over `field`
 * end in `assertNever`: adding a member here stops the SQL compiler and the
 * in-memory matcher compiling until both handle it, which is exactly the
 * safety net wanted for something that builds queries.
 */

export const TextRuleSchema = z.object({
  field: z.enum(['title', 'artist', 'album', 'albumArtist']),
  op: z.enum(['contains', 'notContains', 'equals', 'startsWith']),
  value: z.string().trim().min(1).max(200),
})
export type TextRule = z.infer<typeof TextRuleSchema>

export const TagRuleSchema = z.object({
  field: z.literal('tag'),
  op: z.enum(['has', 'notHas']),
  tagId: IdSchema,
})
export type TagRule = z.infer<typeof TagRuleSchema>

export const NumberRuleSchema = z.object({
  field: z.enum(['playCount', 'skipCount', 'duration', 'year']),
  op: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
  value: z.number().finite(),
})
export type NumberRule = z.infer<typeof NumberRuleSchema>

export const DateRuleSchema = z.object({
  field: z.enum(['addedAt', 'lastPlayedAt']),
  op: z.enum(['inLastDays', 'notInLastDays', 'never']),
  /** The window, when op is not 'never' — which ignores it. Thirty days unless said. */
  days: z.number().int().min(1).max(3650).default(30),
})
export type DateRule = z.infer<typeof DateRuleSchema>

export const BoolRuleSchema = z.object({
  field: z.enum(['loved', 'hasLyrics', 'hasArt']),
  op: z.literal('is'),
  value: z.boolean(),
})
export type BoolRule = z.infer<typeof BoolRuleSchema>

/**
 * Rules over analysed audio features. Kept apart from `NumberRuleSchema`
 * because the values live in `song_audio_features`, not on the song row, and a
 * song that has not been analysed yet should simply not match.
 */
export const FeatureRuleSchema = z.object({
  field: z.enum(['bpm', 'energy', 'loudness']),
  op: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
  value: z.number().finite(),
})
export type FeatureRule = z.infer<typeof FeatureRuleSchema>

/** Key, in Camelot notation: exactly this code, or anything that mixes with it. */
export const KeyRuleSchema = z.object({
  field: z.literal('key'),
  op: z.enum(['is', 'compatible']),
  value: CamelotSchema,
})
export type KeyRule = z.infer<typeof KeyRuleSchema>

export const SmartRuleSchema = z.discriminatedUnion('field', [
  TextRuleSchema,
  TagRuleSchema,
  NumberRuleSchema,
  DateRuleSchema,
  BoolRuleSchema,
  FeatureRuleSchema,
  KeyRuleSchema,
])
export type SmartRule = z.infer<typeof SmartRuleSchema>

export const SmartRulesSchema = z.object({
  /** 'all' is AND, 'any' is OR. */
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(SmartRuleSchema).max(20).default([]),
  orderBy: SongSortFieldSchema.default('addedAt'),
  order: SortDirectionSchema.default('desc'),
  /** Cap the result set — what makes "Top 50 most played" possible. */
  limit: z.number().int().min(1).max(5000).nullable().default(null),
})
export type SmartRules = z.infer<typeof SmartRulesSchema>

export const EMPTY_SMART_RULES: SmartRules = {
  match: 'all',
  rules: [],
  orderBy: 'addedAt',
  order: 'desc',
  limit: null,
}
