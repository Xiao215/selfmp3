import { z } from 'zod'
import { CloudAudioSchema, CloudCoverSchema, CloudLyricsSchema, UidSchema } from './cloud.js'
import { CoverToneSchema } from './song.js'

/**
 * Listening together: a room, held by the doorman — see
 * docs/features/listen-together.md.
 *
 * A room is a shared Up next. The person who opens it (the host) plays it;
 * friends join with a code and add songs. A friend signed in with self.mp3
 * brings songs from their own bucket, and the doorman lends exactly those
 * songs' files to the room's members while the room is open; a guest in a
 * browser adds from what is already in the room, or a link.
 *
 *   POST /v1/rooms                         RoomCreate      → RoomJoined   (signed in)
 *   POST /v1/rooms/<code>/join             RoomJoin        → RoomJoined   (a session is optional)
 *   GET  /v1/rooms/<code>?t=<token>                         → RoomState
 *   POST /v1/rooms/<code>/act?t=<token>    RoomAction      → RoomState
 *   GET  /v1/rooms/<code>/socket?t=<token>  WebSocket: RoomServerMessage down, RoomClientMessage up
 *   GET  /v1/rooms/<code>/files/<entry>/<part>?t=<token>   → the file, ranges and all
 *   PUT  /v1/rooms/<code>/link-server?t=<token>  RoomLinkServer  (the host's)
 *
 * The member's token rides in the query rather than a header, because the two
 * things that most need it — a WebSocket from a browser and an <audio>
 * element — cannot send headers.
 */

/** Letters and digits nobody misreads: no 0/O, 1/I/L, and no U. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const ROOM_CODE_LENGTH = 6

/** What someone typed, as a code: case, spaces and dashes do not matter. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '')
}

/** `KQ7482` → `KQ7 482`, for showing. */
export function formatRoomCode(code: string): string {
  const clean = normalizeRoomCode(code)
  return clean.length === ROOM_CODE_LENGTH ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean
}

export const RoomCodeSchema = z
  .string()
  .max(32)
  .transform(normalizeRoomCode)
  .pipe(z.string().regex(/^[2-9A-HJKMNP-TV-Z]{6}$/, 'not a room code'))
export type RoomCode = z.infer<typeof RoomCodeSchema>

/** A member's secret: what proves, on every call, which member is asking. */
export const RoomTokenSchema = z.string().regex(/^[0-9a-f]{32}$/, 'not a room token')

/** A member's or an entry's name inside one room. */
export const RoomIdSchema = z.string().regex(/^[0-9a-f]{12}$/, 'not a room id')

/**
 * Where it plays: on the host's device only (`speaker`), the room's other
 * members being remotes that add, or on every member's device in step
 * (`everyone`).
 */
export const RoomModeSchema = z.enum(['speaker', 'everyone'])
export type RoomMode = z.infer<typeof RoomModeSchema>

/** What members other than the host may do. The host may always do all of it. */
export const RoomRightsSchema = z.object({
  add: z.boolean(),
  skip: z.boolean(),
  /** Pause and play. */
  pause: z.boolean(),
  /** Add a link, played through the host's server; nothing is kept. */
  links: z.boolean(),
})
export type RoomRights = z.infer<typeof RoomRightsSchema>

export const DEFAULT_ROOM_RIGHTS: RoomRights = { add: true, skip: true, pause: false, links: true }

export const RoomMemberNameSchema = z.string().trim().min(1).max(40)

/**
 * `host` opened the room; `friend` joined signed in, and can bring songs from
 * their own bucket; `guest` joined with only a name.
 */
export const RoomMemberKindSchema = z.enum(['host', 'friend', 'guest'])
export type RoomMemberKind = z.infer<typeof RoomMemberKindSchema>

/**
 * A signed-in person's Google profile picture, drawn as their face. The
 * doorman takes it from their session, never from anything a device sends.
 */
export const MemberPictureSchema = z
  .string()
  .max(2000)
  .url()
  .regex(/^https:\/\//, 'an https address')

export const RoomMemberSchema = z.object({
  id: RoomIdSchema,
  name: RoomMemberNameSchema,
  kind: RoomMemberKindSchema,
  /** Which of the room's eight face colours is theirs. */
  colour: z.number().int().min(0).max(7),
  /** Their face's picture; null for a guest, or anyone without one. */
  picture: MemberPictureSchema.nullable(),
  joinedAt: z.number().int().nonnegative(),
  /** Has a socket open right now. */
  online: z.boolean(),
  /** Left, or was asked to. Their songs that already played stay in the list. */
  left: z.boolean(),
})
export type RoomMember = z.infer<typeof RoomMemberSchema>

const TextSchema = z.string().max(300)

/**
 * A song as a room carries it: everything a device needs to show and play it,
 * and nothing about whose library it came from beyond the keys of its files.
 * The keys are checked against the bucket's own key shapes, so a room can
 * never point the doorman at anything but a song's files.
 *
 * A song from a link has no files: `audio` is null, `link` is where it plays
 * from, and `artwork` is the picture the link's page showed.
 */
export const RoomSongSchema = z.object({
  /** The song's uid in its owner's library; null for a link. */
  uid: UidSchema.nullable(),
  title: TextSchema.min(1),
  artist: TextSchema,
  album: TextSchema,
  /** Seconds. Zero means unknown. */
  duration: z.number().nonnegative().max(36_000),
  audio: CloudAudioSchema.nullable(),
  cover: CloudCoverSchema.nullable(),
  coverTone: CoverToneSchema.nullable(),
  lyrics: CloudLyricsSchema.nullable(),
  /** Where the song came from: what Get it imports from. */
  sourceUrl: z.string().url().max(2000).nullable(),
  /** A link's own song: its address. */
  link: z.string().url().max(2000).nullable(),
  /** A link's picture. */
  artwork: z.string().url().max(2000).nullable(),
})
export type RoomSong = z.infer<typeof RoomSongSchema>

export const RoomEntrySchema = z.object({
  id: RoomIdSchema,
  song: RoomSongSchema,
  /** Who put it in. */
  addedBy: RoomIdSchema,
  /**
   * Whose bucket it plays from; null for a link, and for a song from a shared
   * playlist whose owner is not in the room (`from`).
   */
  owner: RoomIdSchema.nullable(),
  /** Whose song it is when they are not in the room: a shared playlist's (`/from-shared`). */
  from: RoomMemberNameSchema.nullable(),
  /** That owner's face's picture, when they have one. */
  fromPicture: MemberPictureSchema.nullable(),
  addedAt: z.number().int().nonnegative(),
  /**
   * Where the host moved it to in the list, counted from the top of what is
   * still to play. A moved song leaves the turns (roomOrder).
   */
  at: z.number().int().nonnegative().nullable(),
  /** When it finished, or was skipped. Null while it waits or plays. */
  playedAt: z.number().int().nonnegative().nullable(),
})
export type RoomEntry = z.infer<typeof RoomEntrySchema>

/**
 * What is playing, on the doorman's clock. A device works the position out
 * from it with its own clock's offset, so every member's progress bar moves
 * without the host sending anything but changes.
 */
export const RoomPlayingSchema = z.object({
  entryId: RoomIdSchema,
  /** When the song's first second played (doorman ms); moved on by seeks. */
  startedAt: z.number(),
  /** Seconds in, while paused; null while it plays. */
  pausedAt: z.number().nonnegative().nullable(),
})
export type RoomPlaying = z.infer<typeof RoomPlayingSchema>

/**
 * A member asking the host's player for something it alone can do. Numbered,
 * so the host's device acts on each once, however often it hears the state.
 */
export const RoomWantSchema = z.object({
  seq: z.number().int().positive(),
  kind: z.enum(['skip', 'pause', 'play']),
  by: RoomIdSchema,
})
export type RoomWant = z.infer<typeof RoomWantSchema>

/** A friend's shelf: one tag or playlist of theirs, for the room to add from. */
export const RoomShelfSchema = z.object({
  member: RoomIdSchema,
  name: TextSchema.min(1),
  songs: z.array(RoomSongSchema).max(500),
})
export type RoomShelf = z.infer<typeof RoomShelfSchema>

/** The room as the doorman keeps it. Everything here is the members' to see. */
export const RoomDocSchema = z.object({
  code: RoomCodeSchema,
  createdAt: z.number().int().nonnegative(),
  mode: RoomModeSchema,
  rights: RoomRightsSchema,
  /** Near the end of the list, add songs like the last ones. */
  keepGoing: z.boolean(),
  members: z.array(RoomMemberSchema),
  /** Every song still to play, playing, and the latest that played, in the order they were added. */
  entries: z.array(RoomEntrySchema),
  shelves: z.array(RoomShelfSchema),
  playing: RoomPlayingSchema.nullable(),
  want: RoomWantSchema.nullable(),
  endedAt: z.number().int().nonnegative().nullable(),
  /**
   * The host's server can be reached from the internet, and the doorman plays
   * links through it for everyone (`RoomLinkServer`); without it a link plays
   * on the host's device alone.
   */
  linkRelay: z.boolean(),
  /** The last time anyone did anything: a room nobody touches for two hours ends. */
  activeAt: z.number().int().nonnegative(),
})
export type RoomDoc = z.infer<typeof RoomDocSchema>

/** What a member is sent: the room, the list in the order it will play, and the doorman's clock. */
export const RoomStateSchema = RoomDocSchema.extend({
  /** Waiting entries' ids, next first (roomOrder). */
  order: z.array(RoomIdSchema),
  /** The member this state was sent to. */
  you: RoomIdSchema,
  serverTime: z.number(),
})
export type RoomState = z.infer<typeof RoomStateSchema>

export const RoomCreateSchema = z.object({
  /** Your name, as the room shows it: "Xiao's room". */
  name: RoomMemberNameSchema,
  mode: RoomModeSchema,
  rights: RoomRightsSchema.default(DEFAULT_ROOM_RIGHTS),
  keepGoing: z.boolean().default(true),
})
export type RoomCreate = z.input<typeof RoomCreateSchema>

export const RoomJoinSchema = z.object({ name: RoomMemberNameSchema })
export type RoomJoin = z.infer<typeof RoomJoinSchema>

export const RoomJoinedSchema = z.object({
  code: RoomCodeSchema,
  member: RoomIdSchema,
  token: RoomTokenSchema,
  state: RoomStateSchema,
})
export type RoomJoined = z.infer<typeof RoomJoinedSchema>

/**
 * Everything a member can do to a room. Who may do what is `canAct`
 * (room.ts); the doorman checks it, and the app hides what you cannot do.
 *
 * `add` brings a song from your own bucket, so it needs you signed in as the
 * member who joined; `report` is the host's player saying what it is on.
 */
export const RoomActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), song: RoomSongSchema }),
  z.object({ type: z.literal('addLink'), song: RoomSongSchema }),
  /** A song already in the room — a shelf's, or one that played — once more. */
  z.object({ type: z.literal('again'), entryId: RoomIdSchema }),
  z.object({
    type: z.literal('fromShelf'),
    member: RoomIdSchema,
    index: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('remove'), entryId: RoomIdSchema }),
  z.object({ type: z.literal('move'), entryId: RoomIdSchema, to: z.number().int().nonnegative() }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('play') }),
  z.object({
    type: z.literal('report'),
    entryId: RoomIdSchema.nullable(),
    position: z.number().nonnegative(),
    playing: z.boolean(),
  }),
  z.object({
    type: z.literal('settings'),
    rights: RoomRightsSchema.optional(),
    keepGoing: z.boolean().optional(),
    mode: RoomModeSchema.optional(),
  }),
  z.object({ type: z.literal('shelf'), shelf: RoomShelfSchema.omit({ member: true }).nullable() }),
  z.object({ type: z.literal('kick'), member: RoomIdSchema }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('end') }),
])
export type RoomAction = z.infer<typeof RoomActionSchema>

/**
 * Where the host's server can be reached from the internet, and its token:
 * what lets the doorman play a link through it for members whose devices
 * cannot reach it. Kept by the room beside its members' tokens, never sent to
 * a member, and forgotten with the room.
 *
 *   PUT /v1/rooms/<code>/link-server?t=<host's token>   RoomLinkServer | null
 */
export const RoomLinkServerSchema = z
  .object({
    base: z
      .string()
      .url()
      .max(300)
      .regex(/^https:\/\/[^/?#]+$/, 'an https address with nothing after the host'),
    token: z.string().min(1).max(500).nullable(),
  })
  .nullable()
export type RoomLinkServer = z.infer<typeof RoomLinkServerSchema>

/**
 * How songs in the room sound (soundVectors.ts), for Keep it going: each
 * packed vector by its song's audio key, all from one model. A member sends
 * the vectors of their own songs, from their own bucket's pack; the host's
 * device reads them all. Kept apart from the room, so no state carries them.
 *
 *   POST /v1/rooms/<code>/vectors?t=<token>   RoomVectors   (a member's own songs)
 *   GET  /v1/rooms/<code>/vectors?t=<token>   → RoomVectors
 */
export const RoomVectorsSchema = z.object({
  model: z.string().min(1).max(100),
  vectors: z.record(CloudAudioSchema.shape.key, z.string().length(1024)),
})
export type RoomVectors = z.infer<typeof RoomVectorsSchema>

/** Vectors a room keeps, and takes in one go. */
export const ROOM_MAX_VECTORS = 2000
export const ROOM_VECTORS_AT_ONCE = 300

/** The parts of a song the doorman lends. */
export const RoomFilePartSchema = z.enum(['audio', 'cover', 'lyrics'])
export type RoomFilePart = z.infer<typeof RoomFilePartSchema>

export const RoomClientMessageSchema = z.object({ type: z.literal('ping'), id: z.number().int() })
export type RoomClientMessage = z.infer<typeof RoomClientMessageSchema>

export const RoomServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: RoomStateSchema }),
  z.object({ type: z.literal('pong'), id: z.number().int(), serverTime: z.number() }),
  /** The room is over for you: it ended, or you were asked to leave. */
  z.object({ type: z.literal('gone'), reason: z.enum(['ended', 'removed']) }),
])
export type RoomServerMessage = z.infer<typeof RoomServerMessageSchema>
