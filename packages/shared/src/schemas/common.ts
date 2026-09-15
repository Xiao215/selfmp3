import { z } from 'zod'

/**
 * Primitives reused across the whole contract.
 *
 * Everything the API accepts is parsed through one of these, so an invalid
 * request is rejected at the boundary rather than halfway through a handler.
 */

/** A database row id. Comes off the wire as a string in path params. */
export const IdSchema = z.coerce.number().int().positive()
export type Id = z.infer<typeof IdSchema>

/** Trimmed, non-empty user text with a sane ceiling. */
export const NameSchema = z.string().trim().min(1).max(200)

/** Trimmed text that is allowed to be empty (artist, album, ...). */
export const OptionalTextSchema = z.string().trim().max(500).default('')

export const OkSchema = z.object({ ok: z.literal(true) })
export type Ok = z.infer<typeof OkSchema>

/**
 * A boolean in a query string.
 *
 * Deliberately NOT `z.coerce.boolean()` — that runs JavaScript's `Boolean()`,
 * under which the string `"0"` is `true`. A request for `?deleteFile=0` would
 * then delete the file, which is about as bad as a coercion bug gets.
 */
export const BooleanQuerySchema = z
  .union([z.boolean(), z.string()])
  .default(false)
  .transform(value => {
    if (typeof value === 'boolean') return value
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  })

export const ErrorBodySchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
})
export type ErrorBody = z.infer<typeof ErrorBodySchema>

/** Sort directions, shared by the library view and smart playlists. */
export const SortDirectionSchema = z.enum(['asc', 'desc'])
export type SortDirection = z.infer<typeof SortDirectionSchema>

export const SongSortFieldSchema = z.enum([
  'addedAt',
  'title',
  'artist',
  'album',
  'duration',
  'playCount',
  'lastPlayedAt',
  'random',
])
export type SongSortField = z.infer<typeof SongSortFieldSchema>
