import { z } from 'zod'
import { IdSchema } from './common.js'
import { ImportEnqueueItemSchema, ImportJobSchema } from './import.js'

/**
 * Playlist migration: a list of songs from another app comes in as text, CSV
 * or a Spotify link, each one is matched to a YouTube result, and the chosen
 * matches go through the normal import queue.
 *
 * Matching is a job because searching fifty songs takes a minute; parsing is
 * synchronous because it is pure.
 */

/** One song as the user's other app described it. */
export const MigrateSourceTrackSchema = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().max(300).default(''),
  album: z.string().trim().max(300).default(''),
  /** Seconds; 0 when the source did not say. */
  duration: z.number().nonnegative().default(0),
})
export type MigrateSourceTrack = z.infer<typeof MigrateSourceTrackSchema>

export const MigrateParseRequestSchema = z.object({
  /** Pasted text, CSV contents, or a single Spotify playlist URL. */
  text: z.string().min(1).max(500_000),
})
export type MigrateParseRequest = z.infer<typeof MigrateParseRequestSchema>

export const MigrateSourceKindSchema = z.enum(['text', 'csv', 'spotify'])
export type MigrateSourceKind = z.infer<typeof MigrateSourceKindSchema>

export const MigrateParseResultSchema = z.object({
  kind: MigrateSourceKindSchema,
  playlistName: z.string().nullable(),
  tracks: z.array(MigrateSourceTrackSchema),
  /** Lines that could not be understood, so the user can fix them by hand. */
  skipped: z.array(z.string()),
})
export type MigrateParseResult = z.infer<typeof MigrateParseResultSchema>

export const MigrateMatchRequestSchema = z.object({
  tracks: z.array(MigrateSourceTrackSchema).min(1).max(500),
})
export type MigrateMatchRequest = z.infer<typeof MigrateMatchRequestSchema>

/** A YouTube result that might be the song, with how sure we are. */
export const MigrateCandidateSchema = z.object({
  url: z.string(),
  title: z.string(),
  channel: z.string(),
  duration: z.number().nonnegative(),
  thumbnail: z.string().nullable(),
  /** 0–1. Green at 0.8, amber at 0.5, red below. */
  confidence: z.number().min(0).max(1),
})
export type MigrateCandidate = z.infer<typeof MigrateCandidateSchema>

export const MigrateMatchItemSchema = z.object({
  source: MigrateSourceTrackSchema,
  /** Best first, at most three. Empty when nothing was found. */
  candidates: z.array(MigrateCandidateSchema),
  /** A song with this title and artist is already in the library. */
  alreadyHave: z.boolean(),
  error: z.string().nullable(),
})
export type MigrateMatchItem = z.infer<typeof MigrateMatchItemSchema>

export const MigrateMatchStatusSchema = z.enum(['running', 'done', 'cancelled'])
export type MigrateMatchStatus = z.infer<typeof MigrateMatchStatusSchema>

export const MigrateMatchJobSchema = z.object({
  id: z.string(),
  status: MigrateMatchStatusSchema,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  /** Index-aligned with the request; null until that track has been searched. */
  items: z.array(MigrateMatchItemSchema.nullable()),
})
export type MigrateMatchJob = z.infer<typeof MigrateMatchJobSchema>

export const MigrateEnqueueSchema = z.object({
  items: z.array(ImportEnqueueItemSchema).min(1).max(500),
  tagIds: z.array(IdSchema).max(50).default([]),
  /** Create (or reuse) a manual playlist with this name and add every import to it. */
  playlistName: z.string().trim().max(200).nullable().default(null),
})
export type MigrateEnqueue = z.infer<typeof MigrateEnqueueSchema>

export const MigrateEnqueueResultSchema = z.object({
  jobs: z.array(ImportJobSchema),
  skipped: z.number().int().nonnegative(),
  playlistId: IdSchema.nullable(),
})
export type MigrateEnqueueResult = z.infer<typeof MigrateEnqueueResultSchema>
