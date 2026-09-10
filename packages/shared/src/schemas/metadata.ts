import { z } from 'zod'
import { NameSchema, OptionalTextSchema } from './common.js'

/**
 * Metadata polish: looking a song up on free public databases and applying
 * the corrections the user picks.
 *
 * Nothing here needs an API key. Candidates are suggestions only — the user
 * (or the confidence threshold, for the cover-art pass) decides what lands.
 */

export const MetadataSourceSchema = z.enum(['itunes', 'musicbrainz'])
export type MetadataSource = z.infer<typeof MetadataSourceSchema>

export const MetadataCandidateSchema = z.object({
  source: MetadataSourceSchema,
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  albumArtist: z.string().optional(),
  year: z.number().int().optional(),
  trackNo: z.number().int().optional(),
  durationSec: z.number().nonnegative().optional(),
  artworkUrl: z.string().url().optional(),
  /** 0-1, how well this candidate matches the song's current metadata. */
  score: z.number().min(0).max(1),
})
export type MetadataCandidate = z.infer<typeof MetadataCandidateSchema>

export const MetadataLookupResponseSchema = z.object({
  candidates: z.array(MetadataCandidateSchema),
})
export type MetadataLookupResponse = z.infer<typeof MetadataLookupResponseSchema>

/** The subset of a candidate the user chose to apply. */
export const ApplyMetadataSchema = z
  .object({
    title: NameSchema,
    artist: OptionalTextSchema,
    album: OptionalTextSchema,
    albumArtist: OptionalTextSchema,
    year: z.number().int().min(0).max(9999).nullable(),
    trackNo: z.number().int().min(0).max(9999).nullable(),
    /** Downloaded server-side and stored as the song's cover. */
    artworkUrl: z.string().url().max(2000),
  })
  .partial()
  .refine(patch => Object.keys(patch).length > 0, { message: 'nothing to apply' })
export type ApplyMetadata = z.infer<typeof ApplyMetadataSchema>

export const ApplyMetadataResultSchema = z.object({
  ok: z.literal(true),
  /** False when an artworkUrl was given but could not be fetched. */
  artworkSaved: z.boolean(),
})
export type ApplyMetadataResult = z.infer<typeof ApplyMetadataResultSchema>

/** Progress of the background "find missing cover art" pass. */
export const FixCoversStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'done', 'cancelled']),
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  found: z.number().int().nonnegative(),
  currentTitle: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type FixCoversStatus = z.infer<typeof FixCoversStatusSchema>
