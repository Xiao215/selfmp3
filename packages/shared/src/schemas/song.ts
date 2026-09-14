import { z } from 'zod'
import { IdSchema, NameSchema, OptionalTextSchema } from './common.js'
import { SongFeaturesSchema } from './features.js'

/** Whether a song has lyrics, and whether they carry timestamps. */
export const LyricsKindSchema = z.enum(['none', 'plain', 'synced'])
export type LyricsKind = z.infer<typeof LyricsKindSchema>

/**
 * The most vivid colour in a song's cover, as OKLCH hue and chroma, picked by
 * the server (`coverTone.ts`). Devices draw the playing song in it.
 */
export const CoverToneSchema = z.object({
  hue: z.number().min(0).max(360),
  chroma: z.number().nonnegative(),
})
export type CoverTone = z.infer<typeof CoverToneSchema>

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
  /**
   * Changes whenever the audio file or the cover changes. Media URLs carry it
   * so caches never serve an old file under a reused id. Optional because
   * older servers do not send it.
   */
  rev: z.string().optional(),
  /**
   * The cover's colour. Null for a song with no cover, a cover with no colour
   * in it, or one the server has not read yet. Absent from older servers.
   */
  coverTone: CoverToneSchema.nullable().optional(),
  lyricsKind: LyricsKindSchema,
  /**
   * True when the song is known to have no words: lrclib said so, or you
   * marked it. Distinct from lyricsKind 'none', which only means none were
   * found. Defaults to false for older servers.
   */
  instrumental: z.boolean().default(false),
  playCount: z.number().int().nonnegative(),
  skipCount: z.number().int().nonnegative(),
  loved: z.boolean(),
  sourceUrl: z.string().nullable(),
  lastPlayedAt: z.string().nullable(),
  addedAt: z.string(),
  /** True when the file vanished from disk but we kept the metadata. */
  missing: z.boolean(),
  tagIds: z.array(IdSchema),
  /** Null until the background analyser has looked at the file. */
  features: SongFeaturesSchema.nullable().default(null),
})
export type Song = z.infer<typeof SongSchema>

/**
 * Fields a user may edit by hand. Everything else is derived from the file.
 * An edit on any device is a change to some of these (schemas/sync.ts).
 */
export const SongFieldsSchema = z.object({
  title: NameSchema,
  artist: OptionalTextSchema,
  album: OptionalTextSchema,
  albumArtist: OptionalTextSchema,
  year: z.number().int().min(0).max(9999).nullable(),
  trackNo: z.number().int().min(0).max(9999).nullable(),
  loved: z.boolean(),
  /** Mark or unmark a song as having no words, so no lyrics are looked up. */
  instrumental: z.boolean(),
})
export type SongFields = z.infer<typeof SongFieldsSchema>

export const SONG_FIELDS = SongFieldsSchema.keyof().options

export const SongPatchSchema = SongFieldsSchema.partial().refine(
  patch => Object.keys(patch).length > 0,
  { message: 'no fields to update' },
)
export type SongPatch = z.infer<typeof SongPatchSchema>

export const SetSongTagsSchema = z.object({
  tagIds: z.array(IdSchema).max(100),
})
export type SetSongTags = z.infer<typeof SetSongTagsSchema>

/**
 * Remove many songs from the library in one request.
 *
 * `deleteFile` is a separate field with a `false` default rather than part of
 * the id list for the same reason the per-song route keeps it in the query
 * string and off by default: "remove from my list" and "destroy the files"
 * are different intentions, and forty of them at once is not undoable.
 */
export const BulkDeleteSongsSchema = z.object({
  songIds: z.array(IdSchema).min(1).max(2000),
  deleteFile: z.boolean().default(false),
})
export type BulkDeleteSongs = z.infer<typeof BulkDeleteSongsSchema>

/**
 * What went wrong for one song in a batch.
 *
 * `removed` distinguishes "nothing happened to this song" from "the row went
 * but the file did not" — a file that is already gone from disk must not
 * abort the rest of the batch, but it should still be reported.
 */
export const BulkDeleteFailureSchema = z.object({
  songId: IdSchema,
  reason: z.string(),
  removed: z.boolean(),
})
export type BulkDeleteFailure = z.infer<typeof BulkDeleteFailureSchema>

export const BulkDeleteResultSchema = z.object({
  /** Rows actually removed from the library. */
  removed: z.number().int().nonnegative(),
  /** Audio files actually deleted from disk. Always 0 without `deleteFile`. */
  filesDeleted: z.number().int().nonnegative(),
  failed: z.array(BulkDeleteFailureSchema),
})
export type BulkDeleteResult = z.infer<typeof BulkDeleteResultSchema>

/** Love or unlove many songs at once, so the UI needs one request, not N. */
export const BulkLovedSchema = z.object({
  songIds: z.array(IdSchema).min(1).max(2000),
  loved: z.boolean(),
})
export type BulkLoved = z.infer<typeof BulkLovedSchema>

/**
 * Reported by the client when a song finishes or is abandoned.
 *
 * The client decides what counts as "played" (it knows about seeking and
 * pausing); the server just records what it is told and derives stats later.
 */
export const PlayEventSchema = z.object({
  /** Seconds of audio actually heard. */
  msPlayed: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1000),
  /** True when the track ran to its natural end. */
  completed: z.boolean(),
  /**
   * When the play happened, for one reported late. A phone on a train holds
   * its plays and sends them once the server is reachable, and it must
   * not stamp them with the time they arrived. Absent means "just now".
   */
  playedAt: z.string().datetime({ offset: true }).optional(),
  /**
   * Unique per play on the device that made it. A send whose response was
   * lost gets retried, and the same id arriving twice is recorded once.
   */
  clientId: z.string().min(8).max(64).optional(),
})
export type PlayEvent = z.infer<typeof PlayEventSchema>

export const PlayRecordedSchema = z.object({
  ok: z.literal(true),
  /** True when this `clientId` was already recorded, so nothing changed. */
  duplicate: z.boolean(),
})
export type PlayRecorded = z.infer<typeof PlayRecordedSchema>

export const SkipEventSchema = z.object({
  atSeconds: z.number().nonnegative(),
  /**
   * The outbox's own id for this skip, so one sent twice counts once.
   *
   * Same reasoning as a play's `clientId`: a phone that loses the response
   * keeps the event and sends it again, and without something to recognise it
   * by the skip is counted each time. Optional because a client that has
   * nothing to resend need not have an id.
   */
  clientId: z.string().min(8).max(64).optional(),
})
export type SkipEvent = z.infer<typeof SkipEventSchema>

export const LyricsResponseSchema = z.object({
  source: z.enum(['sidecar', 'embedded', 'remote']),
  kind: LyricsKindSchema,
  text: z.string(),
  /**
   * A romanized line for each line of `text`, in order, empty where a line
   * needed none; null when the words are not Chinese or Japanese, or the
   * server could not romanize them. Part of the lyrics so that whatever keeps
   * the words keeps their romaji, and a device away from its server still has
   * both. Absent from a server older than this field.
   */
  romanized: z.array(z.string()).nullable().optional(),
})
export type LyricsResponse = z.infer<typeof LyricsResponseSchema>
