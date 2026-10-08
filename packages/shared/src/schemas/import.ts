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
  waiting: 'Waiting',
  resolving: 'Reading track info',
  downloading: 'Downloading audio',
  converting: 'Processing audio',
  lyrics: 'Looking for lyrics',
  saving: 'Adding to library',
  uploading: 'Saving to your storage',
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

/** Where a song's audio is downloaded from. */
export const ImportSourceSchema = z.enum(['youtube', 'netease'])
export type ImportSource = z.infer<typeof ImportSourceSchema>

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
  /**
   * True when a job for this song is already in the server's queue, waiting
   * or downloading: it is coming, and asking for it again would only be
   * refused as a duplicate.
   */
  inQueue: z.boolean(),
  /** Where `url` downloads from: YouTube, or 网易云音乐 (docs/features/import-sources.md). */
  source: ImportSourceSchema,
  /**
   * The song on 网易云 when the list came from there. `free` is whether 网易云
   * gives the whole song to this server: a VIP song, or one it may not play
   * here, comes out as a preview of thirty to forty-five seconds, so such a
   * song comes from YouTube instead.
   */
  netease: z.object({ url: z.string(), free: z.boolean() }).nullable(),
  /**
   * The song on YouTube, found there by its name: a Spotify list, a list of
   * song names, a 网易云 song it will not give out — or one switched to
   * YouTube by hand. Null for a pasted YouTube link (`url` is the song) and
   * for a 网易云 song nobody has asked YouTube about.
   */
  youtube: z
    .object({
      /** The match; null while `match` is `looking` or `none`. */
      url: z.string().nullable(),
      /** How the name matched: still `looking`, `sure`, `unsure` (worth a listen), or `none` found. */
      match: z.enum(['looking', 'sure', 'unsure', 'none']),
    })
    .nullable(),
})
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>

/** What a review's songs were listed by: what was pasted, which `from` says on the review. */
export const ImportFromSchema = z.enum(['youtube', 'netease', 'spotify', 'list'])
export type ImportFrom = z.infer<typeof ImportFromSchema>

export const ImportPreviewSchema = z.object({
  kind: z.enum(['single', 'playlist']),
  playlistTitle: z.string().nullable(),
  items: z.array(ImportPreviewItemSchema),
  from: ImportFromSchema,
})

/**
 * Songs to find on YouTube by their names: a review's rows asked about a few
 * at a time, so a long list shows at once and fills in as it is found.
 */
export const ImportFindRequestSchema = z.object({
  tracks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        artist: z.string().trim().max(300).default(''),
        album: z.string().trim().max(300).default(''),
        duration: z.number().nonnegative().default(0),
      }),
    )
    .min(1)
    .max(25),
})
export type ImportFindRequest = z.infer<typeof ImportFindRequestSchema>

/** One song found on YouTube Music: what it is called there, and how sure the name match is. */
export const ImportFoundSchema = z.object({
  url: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration: z.number().nonnegative(),
  thumbnail: z.string().nullable(),
  sure: z.boolean(),
})
export type ImportFound = z.infer<typeof ImportFoundSchema>

export const ImportFindResultSchema = z.object({
  /** One answer per track asked about, in order; null where nothing was found. */
  found: z.array(ImportFoundSchema.nullable()),
})
export type ImportFindResult = z.infer<typeof ImportFindResultSchema>

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
  /** Per track, whether a job for it is already in the queue (`ImportPreviewItem`). */
  queued: z.array(z.boolean()),
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

/**
 * The songs in now: the queue since its oldest open job was asked for, which
 * is what a person means by "how far along is it". Per song there is nothing
 * worth a bar — the audio itself arrives in a fraction of a second, and the
 * rest of a song's minute is waiting its turn — so the queue's progress is
 * the progress there is.
 */
export const ImportRunSchema = z.object({
  /** The run's songs that are in: finished since its oldest open job was asked for. */
  done: z.number().int().nonnegative(),
  /** Those and every job of it still open — downloading, waiting, paused — but not what failed. */
  total: z.number().int().nonnegative(),
  /** About how long the rest will take; null when nothing is moving. */
  leftMs: z.number().nonnegative().nullable(),
})
export type ImportRun = z.infer<typeof ImportRunSchema>

export const ImportQueueSchema = z.object({
  /** Every job still open — running, waiting, failed, paused — then the newest finished ones, up to the limit asked for. */
  jobs: z.array(ImportJobSchema),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  /** How many finished jobs there are in all, however many `jobs` holds. */
  done: z.number().int().nonnegative(),
  pacing: ImportPacingSchema,
  /** Null with nothing open but failures. */
  run: ImportRunSchema.nullable(),
})
export type ImportQueue = z.infer<typeof ImportQueueSchema>

export const ToolStatusSchema = z.object({
  ytdlp: z.boolean(),
  ffmpeg: z.boolean(),
  ytdlpVersion: z.string().nullable(),
})
export type ToolStatus = z.infer<typeof ToolStatusSchema>

/** What Pause all, Resume all, Retry all, Remove all and Clear answer: how many jobs each moved. */
export const ImportsPausedSchema = z.object({ paused: z.number().int().nonnegative() })
export const ImportsResumedSchema = z.object({ resumed: z.number().int().nonnegative() })
export const ImportsRetriedSchema = z.object({ retried: z.number().int().nonnegative() })
export const ImportsRemovedSchema = z.object({ removed: z.number().int().nonnegative() })
export const ImportsClearedSchema = z.object({ cleared: z.number().int().nonnegative() })

/** The colour of a review song's cover, read by the server (services/previewCoverTone.ts). */
export const ImportCoverToneSchema = z.object({
  tone: CoverToneSchema.nullable(),
})
export type ImportCoverTone = z.infer<typeof ImportCoverToneSchema>
