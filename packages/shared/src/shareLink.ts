import { assertNever } from './exhaustive.js'
import type { RoomRefusal } from './room.js'
import type { RoomSong } from './schemas/room.js'
import {
  SHARE_MAX_SONGS,
  type ShareAction,
  type ShareDoc,
  type ShareEnded,
  type ShareFace,
  type ShareLink,
  type ShareSummary,
} from './schemas/share.js'

/**
 * A share link's rules (docs/features/share-links.md), the same on the
 * doorman that keeps it and on every device that draws it. Pure, like a
 * room's (room.ts) and a shared playlist's (sharedPlaylist.ts), and refusing
 * the same way.
 *
 * A link lasts a week from its last play, and a month at most from when it
 * was shared (B2): whoever keeps listening keeps it, and one nobody opens
 * goes by itself. Once it ends it lends nothing more but its covers, for its
 * card (E1), and ninety days later the doorman forgets it.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** A week with nothing played ends it. */
export const SHARE_IDLE_MS = 7 * DAY_MS
/** A month from being shared ends it, however much it played. */
export const SHARE_LIMIT_MS = 30 * DAY_MS
/** How long an ended link's card is kept. */
export const SHARE_KEPT_MS = 90 * DAY_MS
/** The last day of a link, when it says it is ending (D1). */
export const SHARE_LAST_DAY_MS = DAY_MS

/** The most asks one link keeps, and names of people who opened it. */
const MAX_ASKS = 20
const MAX_OPENED = 50

function refuse(refused: RoomRefusal['refused'], message: string): RoomRefusal {
  return { refused, message }
}

export function newShareDoc(input: {
  id: string
  name: string
  kind: ShareDoc['kind']
  from: ShareFace
  songs: readonly { id: string; song: RoomSong }[]
  now: number
}): ShareDoc {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    from: input.from,
    entries: input.songs
      .slice(0, SHARE_MAX_SONGS)
      .map(({ id, song }) => ({ id, song, gone: false })),
    createdAt: input.now,
    startedAt: input.now,
    playedAt: null,
    stopped: null,
    plays: 0,
    opened: [],
    guests: 0,
    asks: [],
  }
}

/** What makes a song the same one when it is shared again: its audio file, else its id, link or name. */
export function shareSongKey(song: RoomSong): string {
  return song.audio?.key ?? song.uid ?? song.link ?? song.title
}

/**
 * Shared again: each song as its sender's library has it now, so a file
 * renamed since — its words rewritten, its cover kept another way — is lent
 * by its new name. Every entry keeps its id, and one gone stays gone.
 */
export function shareSongsAgain(doc: ShareDoc, songs: readonly RoomSong[]): ShareDoc {
  const latest = new Map(songs.map(song => [shareSongKey(song), song]))
  return {
    ...doc,
    entries: doc.entries.map(entry => {
      const song = entry.gone ? undefined : latest.get(shareSongKey(entry.song))
      return song ? { ...entry, song } : entry
    }),
  }
}

/** When it ends, as things stand: a week from the last play, the month at most. */
export function shareEndsAt(doc: ShareDoc): number {
  if (doc.stopped) return doc.stopped.at
  const limit = doc.startedAt + SHARE_LIMIT_MS
  const idle = Math.max(doc.startedAt, doc.playedAt ?? doc.startedAt) + SHARE_IDLE_MS
  return Math.min(idle, limit)
}

/** Whether it has ended by now, and why; null while it plays. */
export function shareEnded(doc: ShareDoc, now: number): ShareEnded | null {
  if (doc.stopped) return { at: doc.stopped.at, why: doc.stopped.why }
  const endsAt = shareEndsAt(doc)
  if (now < endsAt) return null
  return { at: endsAt, why: endsAt >= doc.startedAt + SHARE_LIMIT_MS ? 'limit' : 'idle' }
}

/** Until when its card is kept: ninety days after it ends. */
export function shareKeptUntil(doc: ShareDoc): number {
  return shareEndsAt(doc) + SHARE_KEPT_MS
}

/**
 * A song of it played. A play moves its end on; only one heard from its
 * start counts as a play, since a song is fetched in pieces.
 */
export function sharePlayed(doc: ShareDoc, now: number, fromStart: boolean): ShareDoc {
  if (shareEnded(doc, now)) return doc
  return { ...doc, playedAt: now, plays: doc.plays + (fromStart ? 1 : 0) }
}

/** Opened by someone: their name when signed in, else counted as a guest. */
export function shareOpened(doc: ShareDoc, name: string | null): ShareDoc {
  if (name === null) return { ...doc, guests: doc.guests + 1 }
  if (doc.opened.includes(name)) return doc
  return { ...doc, opened: [...doc.opened, name].slice(0, MAX_OPENED) }
}

/** A song's file is no longer in the bucket. With none of them left, the link has ended. */
export function shareGone(doc: ShareDoc, entryId: string, now: number): ShareDoc {
  if (!doc.entries.some(entry => entry.id === entryId && !entry.gone)) return doc
  const entries = doc.entries.map(entry =>
    entry.id === entryId ? { ...entry, gone: true } : entry,
  )
  const allGone = entries.every(entry => entry.gone)
  return {
    ...doc,
    entries,
    stopped: allGone && !doc.stopped ? { at: now, why: 'removed' } : doc.stopped,
  }
}

/**
 * Asked for again (F1), by name. Only once it has ended, and not when its
 * songs left the sender's library: there is nothing to share again. The same
 * name asking twice moves its ask to now.
 */
export function shareAsked(
  doc: ShareDoc,
  ask: { id: string; name: string },
  now: number,
): ShareDoc | RoomRefusal {
  const ended = shareEnded(doc, now)
  if (!ended) return refuse('invalid', 'this link still plays')
  if (ended.why === 'removed') return refuse('ended', 'these songs are no longer in their library')
  const same = (name: string): boolean => name.toLowerCase() === ask.name.toLowerCase()
  const others = doc.asks.filter(other => !same(other.name))
  const kept = doc.asks.find(other => same(other.name))
  return {
    ...doc,
    asks: [...others, { id: kept?.id ?? ask.id, name: ask.name, at: now }].slice(-MAX_ASKS),
  }
}

/** The sender's change to their link, or why not. `forget` is the route's, not the link's. */
export function applyShareAction(
  doc: ShareDoc,
  action: Exclude<ShareAction, { type: 'forget' }>,
  now: number,
): ShareDoc | RoomRefusal {
  switch (action.type) {
    case 'renew': {
      if (doc.stopped?.why === 'removed' || doc.entries.every(entry => entry.gone)) {
        return refuse('ended', 'these songs are no longer in your library')
      }
      return { ...doc, startedAt: now, playedAt: null, stopped: null, asks: [] }
    }
    case 'end':
      if (shareEnded(doc, now)) return doc
      return { ...doc, stopped: { at: now, why: 'stopped' } }
    case 'dismiss':
      return { ...doc, asks: doc.asks.filter(ask => ask.id !== action.askId) }
    default:
      return assertNever(action)
  }
}

/** Whether this song's files may be lent now: audio and words while it plays, covers while its card is kept. */
export function shareLends(
  doc: ShareDoc,
  entryId: string,
  part: 'audio' | 'cover' | 'lyrics',
  now: number,
): boolean {
  const entry = doc.entries.find(candidate => candidate.id === entryId)
  if (!entry || entry.gone) return false
  if (part === 'cover') return now < shareKeptUntil(doc)
  return shareEnded(doc, now) === null
}

/** The link as someone is sent it: how it played and who asked only for whoever sent it. */
export function shareView(
  doc: ShareDoc,
  input: { key: string; yours: boolean; asked: boolean; now: number },
): ShareLink {
  const { key, yours, asked, now } = input
  return {
    id: doc.id,
    key,
    name: doc.name,
    kind: doc.kind,
    from: doc.from,
    entries: doc.entries,
    createdAt: doc.createdAt,
    endsAt: shareEndsAt(doc),
    limitAt: doc.startedAt + SHARE_LIMIT_MS,
    ended: shareEnded(doc, now),
    keptUntil: shareKeptUntil(doc),
    asked,
    yours,
    plays: yours ? doc.plays : 0,
    opened: yours ? doc.opened : [],
    guests: yours ? doc.guests : 0,
    asks: yours ? doc.asks : [],
  }
}

/** The link in a list of yours. */
export function shareSummary(
  doc: ShareDoc,
  input: { key: string; yours: boolean; asked: boolean; now: number },
): ShareSummary {
  const { entries, ...view } = shareView(doc, input)
  return {
    ...view,
    songs: entries.length,
    cover: entries.find(entry => entry.song.cover !== null && !entry.gone)?.id ?? null,
  }
}
