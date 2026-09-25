import { z } from 'zod'
import { IdSchema } from './common.js'
import { CoverToneSchema } from './song.js'

/**
 * The import pipeline: a URL goes in, a tagged song with lyrics comes out.
 *
 * Jobs are persisted in SQLite rather than held in memory, so a queue of forty
 * downloads survives a server restart and a client can watch progress from a
 * cold start.
 */

export const ImportStatusSchema = z.enum(['queued', 'running', 'done', 'error', 'cancelled'])
export type ImportStatus = z.infer<typeof ImportStatusSchema>

export const ImportStepSchema = z.enum([
  'waiting',
  'resolving',
  'downloading',
  'converting',
  'lyrics',
  'saving',
  /**
   * Only with a cloud bucket connected: the song is in the library on this
   * server and the job is not done until it is in the bucket too. A job that
   * failed here keeps this step, so it can be told apart and finished later
   * without downloading the song again.
   */
  'uploading',
  'finished',
])
export type ImportStep = z.infer<typeof ImportStepSchema>

export const IMPORT_STEP_LABELS: Record<ImportStep, string> = {
  waiting: 'Waiting in queue',
  resolving: 'Reading track info',
  downloading: 'Downloading audio',
  converting: 'Processing audio',
  lyrics: 'Looking for lyrics',
  saving: 'Adding to library',
  uploading: 'Uploading to the cloud',
  finished: 'Done',
}

export const ImportJobSchema = z.object({
  id: z.string(),
  url: z.string(),
  status: ImportStatusSchema,
  step: ImportStepSchema,
  /** 0-100 where yt-dlp reports it, otherwise null. */
  progress: z.number().min(0).max(100).nullable(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  thumbnail: z.string().nullable(),
  duration: z.number().nonnegative(),
  error: z.string().nullable(),
  songId: IdSchema.nullable(),
  attempts: z.number().int().nonnegative(),
  tagIds: z.array(IdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ImportJob = z.infer<typeof ImportJobSchema>

/** Metadata scraped from a URL before the user commits to downloading it. */
export const ImportPreviewItemSchema = z.object({
  url: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration: z.number().nonnegative(),
  thumbnail: z.string().nullable(),
  /** True when the library already has this song: the same link, or the same name and length. */
  alreadyHave: z.boolean(),
  /**
   * True when the song counted as yours is on the server that answered but not
   * yet in its bucket — imported, but its upload has not gone through. A
   * library read from the bucket does not show it yet; a second download would
   * only make a copy, and the server keeps sending it up by itself.
   */
  waitingToUpload: z.boolean(),
})
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>

export const ImportPreviewSchema = z.object({
  kind: z.enum(['single', 'playlist']),
  playlistTitle: z.string().nullable(),
  items: z.array(ImportPreviewItemSchema),
})

/**
 * Which of these tracks the library has now, asked again for a review that
 * was kept on the device: "Yours already" is a fact about the library at the
 * moment it is read, and a draft made before a removal — or an import — has
 * the answer from then.
 */
export const AlreadyHaveRequestSchema = z.object({
  tracks: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        artist: z.string(),
        duration: z.number().nonnegative(),
      }),
    )
    .max(2000),
})
export type AlreadyHaveRequest = z.infer<typeof AlreadyHaveRequestSchema>

export const AlreadyHaveResponseSchema = z.object({
  /** One answer per track asked about, in order. */
  have: z.array(z.boolean()),
  /** Per track, whether the song it has is still waiting to upload (`ImportPreviewItem`). */
  waiting: z.array(z.boolean()),
})
export type AlreadyHaveResponse = z.infer<typeof AlreadyHaveResponseSchema>
export type ImportPreview = z.infer<typeof ImportPreviewSchema>

export const ImportPreviewRequestSchema = z.object({
  /** One URL per line. Playlists expand into their tracks. */
  url: z.string().trim().min(1).max(20_000),
})
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>

export const ImportEnqueueItemSchema = z.object({
  url: z.string().trim().url(),
  title: z.string().trim().max(300).default(''),
  artist: z.string().trim().max(300).default(''),
  album: z.string().trim().max(300).default(''),
  thumbnail: z.string().nullable().default(null),
  duration: z.number().nonnegative().default(0),
})
export type ImportEnqueueItem = z.infer<typeof ImportEnqueueItemSchema>

export const ImportEnqueueSchema = z.object({
  items: z.array(ImportEnqueueItemSchema).min(1).max(500),
  tagIds: z.array(IdSchema).max(50).default([]),
  /** Optionally drop every imported track into this playlist. */
  playlistId: IdSchema.nullable().default(null),
  /**
   * Or create (or reuse) a manual playlist with this name and drop the tracks
   * in there — what "also create playlist" does when importing a whole
   * playlist. Ignored when playlistId is set.
   */
  createPlaylistName: z.string().trim().min(1).max(200).nullable().default(null),
})
export type ImportEnqueue = z.infer<typeof ImportEnqueueSchema>

export const ImportEnqueueResultSchema = z.object({
  jobs: z.array(ImportJobSchema),
  /** Tracks left out because they were already queued. */
  skipped: z.number().int().nonnegative(),
  /** The playlist the tracks will land in, when there is one. */
  playlistId: IdSchema.nullable(),
})
export type ImportEnqueueResult = z.infer<typeof ImportEnqueueResultSchema>

/**
 * One-shot import for share sheets: probe and enqueue in a single request,
 * with the default import tags applied. This is what an iOS Shortcut posts,
 * since iOS has no Web Share Target.
 */
export const ImportShareRequestSchema = z.object({
  /** One URL, or free text containing URLs (the share sheet often sends both). */
  url: z.string().trim().min(1).max(20_000),
  tagIds: z.array(IdSchema).max(50).default([]),
  /** Create a playlist with the source playlist's name when the link is one. */
  createPlaylist: z.boolean().default(false),
})
export type ImportShareRequest = z.infer<typeof ImportShareRequestSchema>

export const ImportShareResultSchema = ImportEnqueueResultSchema.extend({
  kind: z.enum(['single', 'playlist']),
  playlistTitle: z.string().nullable(),
})
export type ImportShareResult = z.infer<typeof ImportShareResultSchema>

/** Result of probing YouTube Music with the configured cookies. */
export const YtCookieTestSchema = z.object({
  ok: z.boolean(),
  /** How cookies are configured, echoed back so the UI can explain itself. */
  source: z.enum(['none', 'browser', 'file']),
  /** Tracks found in Liked Music when the probe worked. */
  count: z.number().int().nonnegative().nullable(),
  playlistTitle: z.string().nullable(),
  /** An actionable explanation when it did not. */
  error: z.string().nullable(),
})
export type YtCookieTest = z.infer<typeof YtCookieTestSchema>

/**
 * Why the queue is not moving, when it is not moving for a reason that is
 * nobody's fault.
 *
 * Pacing belongs to the queue rather than to any one job: YouTube limits the
 * address, not the song. A job held back by it is still queued and still fine.
 */
export const ImportPacingSchema = z.object({
  /** ms until the next download may start. 0 when nothing is holding it back. */
  waitMs: z.number().nonnegative(),
  /** Set only while a rate-limit answer is being waited out (epoch ms). */
  pausedUntil: z.number().nullable(),
  /** 1 normally; halved by each rate-limit incident and not restored by itself. */
  ratchet: z.number().positive(),
})
export type ImportPacing = z.infer<typeof ImportPacingSchema>

/** Nothing holding the queue back: what a queue not yet read is assumed to be. */
export const IDLE_PACING: ImportPacing = { waitMs: 0, pausedUntil: null, ratchet: 1 }

export const ImportQueueSchema = z.object({
  /** Every job still open — running, waiting, failed, paused — then the newest finished ones, up to the limit asked for. */
  jobs: z.array(ImportJobSchema),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  /** How many finished jobs there are in all, however many `jobs` holds. */
  done: z.number().int().nonnegative(),
  pacing: ImportPacingSchema,
})
export type ImportQueue = z.infer<typeof ImportQueueSchema>

export const ToolStatusSchema = z.object({
  ytdlp: z.boolean(),
  ffmpeg: z.boolean(),
  ytdlpVersion: z.string().nullable(),
})
export type ToolStatus = z.infer<typeof ToolStatusSchema>

/** The colour of a review song's cover, read by the server (services/previewCoverTone.ts). */
export const ImportCoverToneSchema = z.object({
  tone: CoverToneSchema.nullable(),
})
export type ImportCoverTone = z.infer<typeof ImportCoverToneSchema>
