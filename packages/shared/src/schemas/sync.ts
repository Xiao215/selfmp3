import { z } from 'zod'
import { CloudDeviceIdSchema, CloudSmartRulesSchema, HlcSchema, UidSchema } from './cloud.js'
import { NameSchema } from './common.js'
import { PlaylistKindSchema } from './playlist.js'
import { SongFieldsSchema } from './song.js'
import { TagNameSchema } from './tag.js'

/**
 * The change log (docs/SYNC.md): what a device did, as it travels.
 *
 * Every change says when it was made (`hlc`) and names what it is about by
 * uid. They are written to `log/<device>/<seq>.json`, one file per batch, and
 * every device replays every other device's changes with the same rules
 * (sync.ts), so everyone ends up with the same library.
 *
 * Names are past tense: a change is something that happened, not a request.
 */

/** Plays and skips carry an id of their own, so the same one twice counts once. */
const EventIdSchema = z.string().min(8).max(64)

const at = { hlc: HlcSchema, uid: UidSchema }

export const SongEditedSchema = z.object({
  type: z.literal('songEdited'),
  ...at,
  fields: SongFieldsSchema.partial(),
})

export const SongTaggedSchema = z.object({
  type: z.literal('songTagged'),
  ...at,
  tagUid: UidSchema,
  /** True for putting the tag on, false for taking it off. */
  on: z.boolean(),
})

export const SongRemovedSchema = z.object({ type: z.literal('songRemoved'), ...at })

export const SongPlayedSchema = z.object({
  type: z.literal('songPlayed'),
  ...at,
  playId: EventIdSchema,
  /** When it was heard, which may be long before the change reached anyone. */
  playedAt: z.string().datetime({ offset: true }),
  msPlayed: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1000),
  completed: z.boolean(),
})

export const SongSkippedSchema = z.object({
  type: z.literal('songSkipped'),
  ...at,
  skipId: EventIdSchema,
  skippedAt: z.string().datetime({ offset: true }),
  atSeconds: z.number().nonnegative(),
})

export const TagFieldsSchema = z.object({
  name: TagNameSchema,
  hue: z.number().int().min(0).max(359),
})
export type TagFields = z.infer<typeof TagFieldsSchema>

export const TagCreatedSchema = z.object({
  type: z.literal('tagCreated'),
  ...at,
  ...TagFieldsSchema.shape,
})

export const TagEditedSchema = z.object({
  type: z.literal('tagEdited'),
  ...at,
  fields: TagFieldsSchema.partial(),
})

export const TagRemovedSchema = z.object({ type: z.literal('tagRemoved'), ...at })

export const PlaylistFieldsSchema = z.object({
  name: NameSchema,
  description: z.string().trim().max(500),
  /** Null for a manual playlist. */
  rules: CloudSmartRulesSchema.nullable(),
  pinned: z.boolean(),
})
export type PlaylistFields = z.infer<typeof PlaylistFieldsSchema>

export const PlaylistCreatedSchema = z.object({
  type: z.literal('playlistCreated'),
  ...at,
  kind: PlaylistKindSchema,
  ...PlaylistFieldsSchema.shape,
})

export const PlaylistEditedSchema = z.object({
  type: z.literal('playlistEdited'),
  ...at,
  fields: PlaylistFieldsSchema.partial(),
})

export const PlaylistRemovedSchema = z.object({ type: z.literal('playlistRemoved'), ...at })

/** A song put into a manual playlist (at the end) or taken out of it. */
export const PlaylistSongSchema = z.object({
  type: z.literal('playlistSong'),
  ...at,
  songUid: UidSchema,
  on: z.boolean(),
})

/**
 * A manual playlist put in a new order. Songs it does not mention keep their
 * place after the ones it does, so reordering an old view of a playlist never
 * drops a song another device added meanwhile.
 */
export const PlaylistOrderedSchema = z.object({
  type: z.literal('playlistOrdered'),
  ...at,
  songUids: z.array(UidSchema).max(5000),
})

export const ChangeSchema = z.discriminatedUnion('type', [
  SongEditedSchema,
  SongTaggedSchema,
  SongRemovedSchema,
  SongPlayedSchema,
  SongSkippedSchema,
  TagCreatedSchema,
  TagEditedSchema,
  TagRemovedSchema,
  PlaylistCreatedSchema,
  PlaylistEditedSchema,
  PlaylistRemovedSchema,
  PlaylistSongSchema,
  PlaylistOrderedSchema,
])
export type Change = z.infer<typeof ChangeSchema>
export type ChangeType = Change['type']

/** Bumped when a log file changes in a way an older build cannot read. */
export const LOG_FORMAT = 1

/**
 * `log/<device>/<seq>.json`: one batch of one device's changes.
 *
 * A device numbers its files 1, 2, 3, … and never writes the same number
 * twice with different contents, so a file, once written, never changes.
 * The changes are checked one by one (readLogFile in sync.ts): a change
 * from a newer build is set aside without costing the rest of the file.
 */
export const LogFileSchema = z.object({
  format: z.number().int().positive(),
  device: CloudDeviceIdSchema,
  seq: z.number().int().positive(),
  writtenAt: z.string(),
  changes: z.array(z.unknown()).max(10_000),
})

export interface LogFile {
  readonly format: number
  readonly device: string
  readonly seq: number
  readonly writtenAt: string
  readonly changes: readonly Change[]
}
