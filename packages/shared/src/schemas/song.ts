import { z } from 'zod'
import { IdSchema, NameSchema, OptionalTextSchema } from './common.js'

/** Whether a song has lyrics, and whether they carry timestamps. */
export const LyricsKindSchema = z.enum(['none', 'plain', 'synced'])
export type LyricsKind = z.infer<typeof LyricsKindSchema>

/**
 * A song as the API returns it.
 *
 * `path` is deliberately relative to the library root and never absolute — the
 * client has no business knowing where the library lives on disk, and it keeps
 * the payload identical whether files sit on local disk or in object storage.
 */
export const SongSchema = z.object({
  id: IdSchema,
  path: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  albumArtist: z.string(),
  trackNo: z.number().int().nullable(),
  year: z.number().int().nullable(),
  /** Seconds. Zero means "unknown", not "empty". */
  duration: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  mime: z.string(),
  hasArt: z.boolean(),
  lyricsKind: LyricsKindSchema,
  playCount: z.number().int().nonnegative(),
  skipCount: z.number().int().nonnegative(),
  loved: z.boolean(),
  sourceUrl: z.string().nullable(),
  lastPlayedAt: z.string().nullable(),
  addedAt: z.string(),
  /** True when the file vanished from disk but we kept the metadata. */
  missing: z.boolean(),
  tagIds: z.array(IdSchema),
})
export type Song = z.infer<typeof SongSchema>

/** Fields a user may edit by hand. Everything else is derived from the file. */
export const SongPatchSchema = z
  .object({
    title: NameSchema,
    artist: OptionalTextSchema,
    album: OptionalTextSchema,
    albumArtist: OptionalTextSchema,
    year: z.number().int().min(0).max(9999).nullable(),
    trackNo: z.number().int().min(0).max(9999).nullable(),
    loved: z.boolean(),
  })
  .partial()
  .refine(patch => Object.keys(patch).length > 0, { message: 'no fields to update' })
export type SongPatch = z.infer<typeof SongPatchSchema>

export const SetSongTagsSchema = z.object({
  tagIds: z.array(IdSchema).max(100),
})
export type SetSongTags = z.infer<typeof SetSongTagsSchema>

/**
 * Reported by the client when a song finishes or is abandoned.
 *
 * The client decides what counts as "played" (it knows about seeking and
 * pausing); the server just records what it is told and derives stats later.
 */
export const PlayEventSchema = z.object({
  /** Seconds of audio actually heard. */
  msPlayed: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
  /** True when the track ran to its natural end. */
  completed: z.boolean(),
})
export type PlayEvent = z.infer<typeof PlayEventSchema>

export const SkipEventSchema = z.object({
  atSeconds: z.number().nonnegative(),
})
export type SkipEvent = z.infer<typeof SkipEventSchema>

export const LyricsResponseSchema = z.object({
  source: z.enum(['sidecar', 'embedded', 'remote']),
  kind: LyricsKindSchema,
  text: z.string(),
})
export type LyricsResponse = z.infer<typeof LyricsResponseSchema>
