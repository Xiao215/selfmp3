import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Tags are the primary way the library is organised — they replace folders,
 * genres and star ratings with one flat, user-defined vocabulary.
 */
export const TagSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Hue 0-359, derived once at creation so a tag's colour never shifts. */
  hue: z.number().int().min(0).max(359),
  songCount: z.number().int().nonnegative(),
})
export type Tag = z.infer<typeof TagSchema>

/** Tag names are compared case-insensitively, so we normalise whitespace too. */
export const TagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .transform(s => s.replace(/\s+/g, ' '))

export const CreateTagSchema = z.object({
  name: TagNameSchema,
  hue: z.number().int().min(0).max(359).optional(),
})
export type CreateTag = z.infer<typeof CreateTagSchema>

export const RenameTagSchema = z.object({
  name: TagNameSchema.optional(),
  hue: z.number().int().min(0).max(359).optional(),
})
export type RenameTag = z.infer<typeof RenameTagSchema>

/** Apply or remove one tag across many songs at once. */
export const BulkTagSchema = z.object({
  songIds: z.array(IdSchema).min(1).max(2000),
  tagId: IdSchema,
  action: z.enum(['add', 'remove']),
})
export type BulkTag = z.infer<typeof BulkTagSchema>
