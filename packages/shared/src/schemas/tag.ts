import { z } from 'zod'
import { HueSchema, IdSchema } from './common.js'

/**
 * Tags are the primary way the library is organised — they replace folders,
 * genres and star ratings with one flat, user-defined vocabulary.
 */
export const TagSchema = z.object({
  id: IdSchema,
  name: z.string(),
  hue: HueSchema,
  songCount: z.number().int().nonnegative(),
})
export type Tag = z.infer<typeof TagSchema>

/**
 * The longest a tag name may be. A tag is a word or two — long enough for
 * "late night driving", short enough that a row of them still reads as chips.
 * The name fields stop typing here as well, so nothing is typed that the
 * server would then refuse.
 */
export const TAG_NAME_MAX = 30

/** Tag names are compared case-insensitively, so we normalise whitespace too. */
export const TagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(TAG_NAME_MAX)
  .transform(s => s.replace(/\s+/g, ' '))

export const CreateTagSchema = z.object({
  name: TagNameSchema,
  hue: HueSchema.optional(),
})
export type CreateTag = z.infer<typeof CreateTagSchema>

export const RenameTagSchema = z.object({
  name: TagNameSchema.optional(),
  hue: HueSchema.optional(),
})
export type RenameTag = z.infer<typeof RenameTagSchema>

/** Apply or remove one tag across many songs at once. */
export const BulkTagSchema = z.object({
  songIds: z.array(IdSchema).min(1).max(2000),
  tagId: IdSchema,
  action: z.enum(['add', 'remove']),
})
export type BulkTag = z.infer<typeof BulkTagSchema>
