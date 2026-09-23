import { z } from 'zod'
import { IdSchema, NameSchema } from './common.js'
import { SmartRulesSchema } from './smart.js'

export const PlaylistKindSchema = z.enum(['manual', 'live'])
export type PlaylistKind = z.infer<typeof PlaylistKindSchema>

/**
 * What kind of playlist it is, and so whether it has rules: a manual one has
 * none and a live one always has a set. One union rather than two fields, so
 * "a live playlist with no rules" is not a value anything has to guard against.
 */
export const ManualPlaylistRulesSchema = z.object({ kind: z.literal('manual'), rules: z.null() })
export const LivePlaylistRulesSchema = z.object({
  kind: z.literal('live'),
  rules: SmartRulesSchema,
})
export type PlaylistRules = z.infer<
  typeof ManualPlaylistRulesSchema | typeof LivePlaylistRulesSchema
>

/**
 * The two fields as a row or a change carries them, one at a time: live only
 * with a rule set, and manual otherwise. Generic over the rules because the
 * bucket names tags by uid (`CloudSmartRules`) where a server names them by id.
 */
export function playlistRules<R>(
  kind: PlaylistKind,
  rules: R | null,
): { kind: 'manual'; rules: null } | { kind: 'live'; rules: R } {
  return kind === 'live' && rules ? { kind: 'live', rules } : { kind: 'manual', rules: null }
}

const PlaylistBaseSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  songCount: z.number().int().nonnegative(),
  /** Total seconds, so the UI can show "1 hr 12 min" without fetching songs. */
  totalDuration: z.number().nonnegative(),
  /** Pinned playlists are listed in the sidebar's Playlists section. */
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * When it was last started as a playlist — Play, Shuffle or a row in it —
   * which is what the playlists page sorts by. Null when never, and for a
   * library that does not keep it (a cloud copy), which sorts those last.
   */
  lastPlayedAt: z.string().nullable().default(null),
})

export const PlaylistSchema = z.discriminatedUnion('kind', [
  PlaylistBaseSchema.merge(ManualPlaylistRulesSchema),
  PlaylistBaseSchema.merge(LivePlaylistRulesSchema),
])
export type Playlist = z.infer<typeof PlaylistSchema>

const CreatePlaylistBaseSchema = z.object({
  name: NameSchema,
  description: z.string().trim().max(500).default(''),
})

export const CreatePlaylistSchema = z.discriminatedUnion('kind', [
  CreatePlaylistBaseSchema.merge(ManualPlaylistRulesSchema),
  CreatePlaylistBaseSchema.merge(LivePlaylistRulesSchema),
])
export type CreatePlaylist = z.infer<typeof CreatePlaylistSchema>

export const UpdatePlaylistSchema = z
  .object({
    name: NameSchema,
    description: z.string().trim().max(500),
    rules: SmartRulesSchema.nullable(),
    pinned: z.boolean(),
  })
  .partial()
  .refine(patch => Object.keys(patch).length > 0, { message: 'no fields to update' })
export type UpdatePlaylist = z.infer<typeof UpdatePlaylistSchema>

export const AddToPlaylistSchema = z.object({
  songIds: z.array(IdSchema).min(1).max(2000),
  /** Insert position; appends when omitted. */
  position: z.number().int().nonnegative().optional(),
})
export type AddToPlaylist = z.infer<typeof AddToPlaylistSchema>

/**
 * Take many songs out of a manual playlist at once.
 *
 * The single-song route stays: this is the multi-select path, and doing it in
 * one transaction keeps the positions consistent and bumps the library
 * version once instead of once per song.
 */
export const RemoveFromPlaylistSchema = z.object({
  songIds: z.array(IdSchema).min(1).max(2000),
})
export type RemoveFromPlaylist = z.infer<typeof RemoveFromPlaylistSchema>

/**
 * Reordering sends the full ordered id list rather than a move instruction.
 * It is a few more bytes but it is idempotent, which matters when a client
 * retries a request over a flaky connection.
 */
export const ReorderPlaylistSchema = z.object({
  songIds: z.array(IdSchema).max(5000),
})
export type ReorderPlaylist = z.infer<typeof ReorderPlaylistSchema>
