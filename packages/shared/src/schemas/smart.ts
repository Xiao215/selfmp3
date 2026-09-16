import { z } from 'zod'
import { IdSchema, SongSortFieldSchema, SortDirectionSchema } from './common.js'
import { CamelotSchema } from './audioFeatures.js'

/**
 * Smart playlist rules.
 *
 * Each rule is a discriminated union member so the compiler can prove every
 * branch is handled when the server turns rules into SQL. Adding a new field
 * here produces a type error in the compiler until the SQL side handles it,
 * which is exactly the safety net we want for something that builds queries.
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
  /** Ignored when op is 'never'. */
  days: z.number().int().min(1).max(3650).optional(),
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

export const SmartRuleSchema = z.union([
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
