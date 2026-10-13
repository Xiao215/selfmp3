import { plural, SHARE_LAST_DAY_MS, type ShareLink, type ShareSummary } from '@selfmp3/shared'
import { roomTrackId, roomTrackSong, yoursOf, type LibraryIndex } from '@selfmp3/client'
import type { RoomTrack } from '../../player/roomTracks'

/**
 * A share link as this device words and plays it (docs/features/share-links.md):
 * where it is in its life, the line under it, its songs as tracks.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Playing; on its last day (D1), when it says so and Get it leads; or over (E1). */
type ShareStage = 'live' | 'lastDay' | 'ended'

export function shareStage(link: Pick<ShareLink, 'endsAt' | 'ended'>, now: number): ShareStage {
  if (link.ended || now >= link.endsAt) return 'ended'
  return link.endsAt - now <= SHARE_LAST_DAY_MS ? 'lastDay' : 'live'
}

/** "20 Oct", in the reader's own way of writing a date. */
function shortDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/** Whole days left, counting a part of one as one. */
function daysLeft(endsAt: number, now: number): number {
  return Math.max(1, Math.ceil((endsAt - now) / DAY_MS))
}

/** The last day, said the way a person would: tonight, or tomorrow. */
function endingWords(endsAt: number, now: number): string {
  return sameLocalDay(endsAt, now) ? 'Ends tonight' : 'Ends tomorrow'
}

/** What its sender's songs are called: "this song", or "these songs". */
function these(link: Pick<ShareLink, 'kind'>): string {
  return link.kind === 'song' ? 'this song' : 'these songs'
}

/**
 * The line under a link's songs on its page: how long it has, or that it is
 * over. A play keeps a link longer only while the month has room.
 */
export function shareTimeLine(
  link: Pick<ShareLink, 'endsAt' | 'limitAt' | 'ended' | 'kind' | 'from'>,
  now: number,
): string {
  const stage = shareStage(link, now)
  if (stage === 'ended') {
    if (link.ended?.why === 'removed') return `${link.from.name} removed ${these(link)}`
    return `Link ended ${shortDate(link.ended?.at ?? link.endsAt)}`
  }
  if (stage === 'lastDay') return endingWords(link.endsAt, now)
  const until = `Here until ${shortDate(link.endsAt)}`
  return link.endsAt < link.limitAt ? `${until} · each play keeps it longer` : until
}

/** "Xiao sent you a song", or the list's own name. */
export function shareFromLine(link: Pick<ShareLink, 'kind' | 'from' | 'entries'>): string {
  if (link.kind === 'song') return `${link.from.name} sent you a song`
  return `${link.from.name} sent you ${plural(link.entries.length, 'song', 'songs')}`
}

/** A link in your Links you shared (F2): who opened it, and how long it has. */
export function sentLine(link: ShareSummary, now: number): string {
  const stage = shareStage(link, now)
  const names = link.opened.slice(0, 3)
  const more = link.opened.length - names.length + link.guests
  const who =
    names.length > 0
      ? `Opened by ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
      : link.guests > 0
        ? `Opened ${plural(link.guests, 'time', 'times')}`
        : 'Not opened yet'
  if (stage === 'ended') {
    if (link.ended?.why === 'removed') return 'Ended · no longer in your library'
    const played = link.plays > 0 ? ` · played ${plural(link.plays, 'time', 'times')}` : ''
    return `Ended ${shortDate(link.ended?.at ?? link.endsAt)}${played}`
  }
  if (stage === 'lastDay') return `${who} · ${endingWords(link.endsAt, now).toLowerCase()}`
  return `${who} · ${plural(daysLeft(link.endsAt, now), 'day', 'days')} left`
}

/** A link on Home's From friends: whose, and how long it has. */
export function receivedLine(link: ShareSummary, now: number): string {
  const stage = shareStage(link, now)
  if (stage === 'ended') return `${link.from.name} · Ended`
  if (stage === 'lastDay') return `${link.from.name} · ${endingWords(link.endsAt, now)}`
  return `${link.from.name} · ${plural(daysLeft(link.endsAt, now), 'day', 'days')}`
}

/** Its songs as tracks the player can play here, from your own copy when you have one. */
export function shareTracks(
  link: ShareLink,
  file: (entryId: string, part: 'audio' | 'cover') => string,
  library: LibraryIndex,
  now: number,
): Map<number, RoomTrack> {
  const playing = shareStage(link, now) !== 'ended'
  const tracks = new Map<number, RoomTrack>()
  for (const entry of link.entries) {
    if (entry.gone) continue
    tracks.set(roomTrackId(entry.id), {
      song: roomTrackSong({ id: entry.id, song: entry.song, addedAt: link.createdAt }),
      stream: playing && entry.song.audio ? { url: file(entry.id, 'audio'), headers: null } : null,
      cover: entry.song.cover ? file(entry.id, 'cover') : null,
      yours: yoursOf(entry.song, library),
    })
  }
  return tracks
}

/**
 * What Get it brings home: the songs not yours that came from a link, even
 * ones gone from the sender’s library — the link they came from is still there.
 */
export function gettable(link: ShareLink, library: LibraryIndex): ShareLink['entries'] {
  return link.entries.filter(
    entry => entry.song.sourceUrl !== null && yoursOf(entry.song, library) === null,
  )
}

/** Where a song's source link opens, by name: "Open on YouTube". */
export function sourceName(url: string): string {
  const host = (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '').toLowerCase().replace(/^www\./, '')
  if (host === 'music.youtube.com') return 'YouTube Music'
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return 'YouTube'
  if (host === 'music.163.com' || host === 'y.music.163.com' || host === '163cn.tv') return '网易云'
  if (host.endsWith('spotify.com')) return 'Spotify'
  if (host.endsWith('bilibili.com') || host === 'b23.tv') return 'bilibili'
  return host || 'the web'
}
