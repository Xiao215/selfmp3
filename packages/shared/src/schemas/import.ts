import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * The import pipeline: a URL goes in, a tagged song with lyrics comes out.
 *
 * Jobs are persisted in SQLite rather than held in memory, so a queue of forty
 * downloads survives a server restart and the phone can watch progress from a
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
  /** True when a song with the same title+artist is already in the library. */
  alreadyHave: z.boolean(),
})
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>

export const ImportPreviewSchema = z.object({
  kind: z.enum(['single', 'playlist']),
  playlistTitle: z.string().nullable(),
  items: z.array(ImportPreviewItemSchema),
})
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
})
export type ImportEnqueue = z.infer<typeof ImportEnqueueSchema>

export const ImportQueueSchema = z.object({
  jobs: z.array(ImportJobSchema),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
})
export type ImportQueue = z.infer<typeof ImportQueueSchema>

export const ToolStatusSchema = z.object({
  ytdlp: z.boolean(),
  ffmpeg: z.boolean(),
  ytdlpVersion: z.string().nullable(),
})
export type ToolStatus = z.infer<typeof ToolStatusSchema>
