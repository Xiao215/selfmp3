import { z } from 'zod'
import { IdSchema, NameSchema } from './common.js'
import { SmartRulesSchema } from './smart.js'

export const PlaylistKindSchema = z.enum(['manual', 'smart'])
export type PlaylistKind = z.infer<typeof PlaylistKindSchema>

export const PlaylistSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  kind: PlaylistKindSchema,
  /** Null for manual playlists; the rule set for smart ones. */
  rules: SmartRulesSchema.nullable(),
  songCount: z.number().int().nonnegative(),
  /** Total seconds, so the UI can show "1 hr 12 min" without fetching songs. */
  totalDuration: z.number().nonnegative(),
  /** Pinned playlists sort to the top of the sidebar. */
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Playlist = z.infer<typeof PlaylistSchema>

export const CreatePlaylistSchema = z.object({
  name: NameSchema,
  description: z.string().trim().max(500).default(''),
  kind: PlaylistKindSchema.default('manual'),
  rules: SmartRulesSchema.nullable().default(null),
})
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
 * Reordering sends the full ordered id list rather than a move instruction.
 * It is a few more bytes but it is idempotent, which matters when the phone
 * retries a request over a flaky connection.
 */
export const ReorderPlaylistSchema = z.object({
  songIds: z.array(IdSchema).max(5000),
})
export type ReorderPlaylist = z.infer<typeof ReorderPlaylistSchema>
