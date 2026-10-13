import { z } from 'zod'
import { MemberPictureSchema, RoomIdSchema, RoomMemberNameSchema, RoomSongSchema } from './room.js'

/**
 * Share links: a song, or a tag or playlist as it was, sent as a link
 * (docs/features/share-links.md). Anyone with the link plays the songs from
 * the sender's bucket — the doorman lends exactly their files — until the
 * link ends; then a card of it stays for a while, so an old link still says
 * what it was and where to go next.
 *
 *   POST /v1/share                         ShareCreate  → ShareLink        (signed in)
 *   GET  /v1/share                                      → ShareSummary[]   the links you sent
 *   GET  /v1/share/received                             → ShareSummary[]   the ones you opened
 *   GET  /v1/share/<id>?k=<key>                         → ShareLink        (a session is optional)
 *   GET  /v1/share/<id>/files/<entry>/<part>?k=<key>    → the file
 *   POST /v1/share/<id>/ask?k=<key>        ShareAsk     → ShareLink        ask its sender again
 *   POST /v1/share/<id>/act                ShareAction  → ShareLink | 204  (signed in)
 *
 * The key is what opens it: the id alone lets nobody in. It rides in the
 * query for the reason a room's token does — an audio element cannot send a
 * header.
 */

export const ShareIdSchema = z.string().regex(/^[0-9a-f]{16}$/, 'not a share link')

/** What a link carries besides its id. */
export const ShareKeySchema = z.string().regex(/^[0-9a-f]{16}$/, 'not a share link')

/** The most songs one link holds. */
export const SHARE_MAX_SONGS = 100

/** The name of what was shared: a song's title, or the tag's or playlist's. */
export const ShareNameSchema = z.string().trim().min(1).max(300)

/** A link's song: `gone` once its file is no longer in the sender's bucket. */
export const ShareEntrySchema = z.object({
  id: RoomIdSchema,
  song: RoomSongSchema,
  gone: z.boolean(),
})
export type ShareEntry = z.infer<typeof ShareEntrySchema>

/** Who sent it, as their face. */
export const ShareFaceSchema = z.object({
  name: RoomMemberNameSchema,
  picture: MemberPictureSchema.nullable(),
})
export type ShareFace = z.infer<typeof ShareFaceSchema>

/**
 * Why a link ended:
 * - `idle`, a week went by with nothing played;
 * - `limit`, a month since it was shared, however much it played;
 * - `stopped`, its sender ended it;
 * - `removed`, none of its songs is in the sender's bucket any more.
 */
export const ShareEndSchema = z.enum(['idle', 'limit', 'stopped', 'removed'])
export type ShareEnd = z.infer<typeof ShareEndSchema>

export const ShareAskSchema = z.object({
  id: RoomIdSchema,
  name: RoomMemberNameSchema,
  at: z.number().int().nonnegative(),
})
export type ShareAskEntry = z.infer<typeof ShareAskSchema>

/** A link, as the doorman keeps it: everything but the key and whose accounts. */
export const ShareDocSchema = z.object({
  id: ShareIdSchema,
  name: ShareNameSchema,
  /** One song, or a tag or playlist as it was. */
  kind: z.enum(['song', 'list']),
  from: ShareFaceSchema,
  entries: z.array(ShareEntrySchema).min(1).max(SHARE_MAX_SONGS),
  createdAt: z.number().int().nonnegative(),
  /** When it was shared, or shared again: its month counts from here. */
  startedAt: z.number().int().nonnegative(),
  /** The last play since `startedAt`; null before the first. */
  playedAt: z.number().int().nonnegative().nullable(),
  /** Ended before its time: by its sender, or by its songs leaving the bucket. */
  stopped: z
    .object({ at: z.number().int().nonnegative(), why: z.enum(['stopped', 'removed']) })
    .nullable(),
  plays: z.number().int().nonnegative(),
  /** The names of the signed-in people who opened it, first opening first. */
  opened: z.array(RoomMemberNameSchema).max(50),
  /** How many times it was opened by someone not signed in. */
  guests: z.number().int().nonnegative(),
  /** Asks to hear it again, since it was last shared. */
  asks: z.array(ShareAskSchema).max(20),
})
export type ShareDoc = z.infer<typeof ShareDocSchema>

/** Whether and why it has ended, and when. */
export const ShareEndedSchema = z.object({
  at: z.number().int().nonnegative(),
  why: ShareEndSchema,
})
export type ShareEnded = z.infer<typeof ShareEndedSchema>

/** A link as whoever opens it is sent it. */
export const ShareLinkSchema = z.object({
  id: ShareIdSchema,
  key: ShareKeySchema,
  name: ShareNameSchema,
  kind: z.enum(['song', 'list']),
  from: ShareFaceSchema,
  entries: z.array(ShareEntrySchema),
  createdAt: z.number().int().nonnegative(),
  /** When it ends, as things stand: a play moves it on, up to the month. */
  endsAt: z.number().int().nonnegative(),
  /** The latest it can end, however much it plays: the month from when it was shared. */
  limitAt: z.number().int().nonnegative(),
  ended: ShareEndedSchema.nullable(),
  /** Until when its card is kept, once it has ended; then it is forgotten. */
  keptUntil: z.number().int().nonnegative(),
  /** You asked for it again since it was last shared (signed in; a guest's device remembers its own). */
  asked: z.boolean(),
  /** You sent it. Only then are the four below filled in. */
  yours: z.boolean(),
  plays: z.number().int().nonnegative(),
  opened: z.array(RoomMemberNameSchema),
  guests: z.number().int().nonnegative(),
  asks: z.array(ShareAskSchema),
})
export type ShareLink = z.infer<typeof ShareLinkSchema>

/** A link in a list of yours: the songs left out, the first cover's entry kept for its tile. */
export const ShareSummarySchema = ShareLinkSchema.omit({ entries: true }).extend({
  songs: z.number().int().nonnegative(),
  /** The entry whose cover the tile shows; null when none of them has one. */
  cover: RoomIdSchema.nullable(),
})
export type ShareSummary = z.infer<typeof ShareSummarySchema>

export const ShareSummariesSchema = z.array(ShareSummarySchema)

export const ShareCreateSchema = z.object({
  name: ShareNameSchema,
  kind: z.enum(['song', 'list']),
  /** Your name, as whoever opens it sees it. */
  you: RoomMemberNameSchema,
  songs: z.array(RoomSongSchema).min(1).max(SHARE_MAX_SONGS),
})
export type ShareCreate = z.infer<typeof ShareCreateSchema>

/** Asking for it again: a guest gives a name; a session's own name is used when there is one. */
export const ShareAskBodySchema = z.object({ name: RoomMemberNameSchema })
export type ShareAskBody = z.infer<typeof ShareAskBodySchema>

export const ShareActionSchema = z.discriminatedUnion('type', [
  /** The sender's: shared again, the same link, its month from now. Answers its asks. */
  z.object({ type: z.literal('renew') }),
  /** The sender's: ended now. */
  z.object({ type: z.literal('end') }),
  /** The sender's: one ask put away without sharing it again. */
  z.object({ type: z.literal('dismiss'), askId: RoomIdSchema }),
  /**
   * Off your list. For whoever opened it, only that; for its sender, the link
   * itself goes, card and all.
   */
  z.object({ type: z.literal('forget') }),
])
export type ShareAction = z.infer<typeof ShareActionSchema>
