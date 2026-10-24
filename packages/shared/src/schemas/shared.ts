import { z } from 'zod'
import { MemberPictureSchema, RoomIdSchema, RoomMemberNameSchema, RoomSongSchema } from './room.js'

/**
 * Shared playlists: a playlist friends keep adding to, after a room or
 * without one (docs/features/listen-together.md, "Shared playlists").
 *
 * It belongs to Google accounts rather than devices, so it is on every device
 * of everyone in it. Each song stays in its owner's bucket, and the doorman
 * lends its files to the playlist's people for as long as the song is in it
 * and its owner is too. Someone leaving takes their songs with them.
 *
 *   GET  /v1/shared                          → SharedSummary[]   yours
 *   POST /v1/shared             SharedCreate → SharedPlaylist
 *   GET  /v1/shared/<id>                     → SharedPlaylist
 *   POST /v1/shared/<id>/join   SharedJoin   → SharedPlaylist
 *   POST /v1/shared/<id>/act    SharedAction → SharedPlaylist
 *   GET  /v1/shared/<id>/files/<entry>/<part>?t=<listen token>   → the file
 *   POST /v1/rooms/<code>/keep?t=<token>  SharedKeep → SharedPlaylist
 *                                                       the room, kept as one
 *   POST /v1/rooms/<code>/from-shared?t=<token>  { shared } → RoomState
 *                                                       its songs into the room
 *
 * All of them need you signed in, but a file: an <audio> element cannot send
 * a header, so it carries the playlist's listen token for you instead, which
 * opens that playlist's songs and nothing else.
 */

export const SharedIdSchema = z.string().regex(/^[0-9a-f]{16}$/, 'not a shared playlist')

/** What an invite link carries besides the playlist: without it, the id alone lets nobody in. */
export const SharedInviteSchema = z.string().regex(/^[0-9a-f]{16}$/, 'not an invite')

export const SharedNameSchema = z.string().trim().min(1).max(120)

export const SharedMemberSchema = z.object({
  id: RoomIdSchema,
  name: RoomMemberNameSchema,
  /** As in a room: which of the eight face colours is theirs. */
  colour: z.number().int().min(0).max(7),
  /** As in a room: their face's picture, or null. */
  picture: MemberPictureSchema.nullable(),
  joinedAt: z.number().int().nonnegative(),
  /** Made it: may rename it, and take out anyone's song. */
  creator: z.boolean(),
})
export type SharedMember = z.infer<typeof SharedMemberSchema>

export const SharedEntrySchema = z.object({
  id: RoomIdSchema,
  song: RoomSongSchema,
  /** Who put it in, and whose bucket it plays from: the same person. */
  owner: RoomIdSchema,
  addedAt: z.number().int().nonnegative(),
})
export type SharedEntry = z.infer<typeof SharedEntrySchema>

/** The most songs a shared playlist holds. */
export const SHARED_MAX_ENTRIES = 500
/** The most people in one. */
export const SHARED_MAX_MEMBERS = 32

export const SharedDocSchema = z.object({
  id: SharedIdSchema,
  name: SharedNameSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  members: z.array(SharedMemberSchema),
  /** In order. */
  entries: z.array(SharedEntrySchema),
})
export type SharedDoc = z.infer<typeof SharedDocSchema>

/** A shared playlist, as one of its people is sent it. */
export const SharedPlaylistSchema = SharedDocSchema.extend({
  /** The person this was sent to. */
  you: RoomIdSchema,
  /** What an invite link carries; every member may invite. */
  invite: SharedInviteSchema,
  /** Opens this playlist's songs' files for you, in an address (`/files`). */
  token: z.string().regex(/^[0-9a-f]{32}$/),
})
export type SharedPlaylist = z.infer<typeof SharedPlaylistSchema>

/** A shared playlist in a list of yours. */
export const SharedSummarySchema = z.object({
  id: SharedIdSchema,
  name: SharedNameSchema,
  people: z.array(
    z.object({
      name: RoomMemberNameSchema,
      colour: z.number().int(),
      picture: MemberPictureSchema.nullable(),
    }),
  ),
  songs: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
export type SharedSummary = z.infer<typeof SharedSummarySchema>

export const SharedSummariesSchema = z.array(SharedSummarySchema)

export const SharedCreateSchema = z.object({
  name: SharedNameSchema,
  /** Your name, as its people see it. */
  you: RoomMemberNameSchema,
  /** Songs of yours to start it with. */
  songs: z.array(RoomSongSchema).max(200).default([]),
})
export type SharedCreate = z.input<typeof SharedCreateSchema>

export const SharedJoinSchema = z.object({
  invite: SharedInviteSchema,
  name: RoomMemberNameSchema,
})
export type SharedJoin = z.infer<typeof SharedJoinSchema>

/** A room kept as a shared playlist: everyone in it who was signed in is in it. */
export const SharedKeepSchema = z.object({ name: SharedNameSchema })
export type SharedKeep = z.infer<typeof SharedKeepSchema>

export const SharedActionSchema = z.discriminatedUnion('type', [
  /** A song of yours, lent from your bucket. */
  z.object({ type: z.literal('add'), song: RoomSongSchema }),
  /** Yours, or anyone's if you made the playlist. */
  z.object({ type: z.literal('remove'), entryId: RoomIdSchema }),
  z.object({ type: z.literal('move'), entryId: RoomIdSchema, to: z.number().int().nonnegative() }),
  z.object({ type: z.literal('rename'), name: SharedNameSchema }),
  /** Out of it, with your songs. The last to leave lets it go. */
  z.object({ type: z.literal('leave') }),
])
export type SharedAction = z.infer<typeof SharedActionSchema>

export const SharedFromRoomSchema = z.object({ shared: SharedIdSchema })
export type SharedFromRoom = z.infer<typeof SharedFromRoomSchema>
