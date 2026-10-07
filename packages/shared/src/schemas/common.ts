import { z, type ZodError } from 'zod'

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

/** How many things a bulk edit changed: `/songs/bulk/edit`, `/songs/bulk/loved`, `/tags/bulk`. */
export const AffectedSchema = z.object({ affected: z.number().int().nonnegative() })
export type Affected = z.infer<typeof AffectedSchema>

/**
 * A boolean in a query string.
 *
 * Deliberately NOT `z.coerce.boolean()` — that runs JavaScript's `Boolean()`,
 * under which the string `"0"` is `true`. A request for `?refresh=0` would
 * then refresh, and a `?destroy=0` would destroy, which is about as bad as a
 * coercion bug gets.
 */
export const BooleanQuerySchema = z
  .union([z.boolean(), z.string()])
  .default(false)
  .transform(value => {
    if (typeof value === 'boolean') return value
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  })

/** Every error the server, the doorman and the web app's worker answer with. */
export const ErrorBodySchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
})
export type ErrorBody = z.infer<typeof ErrorBodySchema>

/**
 * A request that failed its schema, in words a person can act on: each
 * problem with the field it is about, `title: Required; hue: Expected number`.
 * The server and the doorman both answer a bad body with this, so the two say
 * it the same way.
 */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const where = issue.path.join('.')
      return where ? `${where}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/** A tag's colour, as a hue 0–359: derived once at creation so it never shifts. */
export const HueSchema = z.number().int().min(0).max(359)

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
