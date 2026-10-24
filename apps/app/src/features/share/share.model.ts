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

/**
 * How long a link has, as the second half of its page's top line: "6 days
 * left", "ends tonight", or that it is over.
 */
export function shareTimeLine(link: Pick<ShareLink, 'endsAt' | 'ended'>, now: number): string {
  const stage = shareStage(link, now)
  if (stage === 'ended') {
    const at = shortDate(link.ended?.at ?? link.endsAt)
    return link.ended?.why === 'removed' ? `removed ${at}` : `ended ${at}`
  }
  if (stage === 'lastDay') return endingWords(link.endsAt, now).toLowerCase()
  return `${plural(daysLeft(link.endsAt, now), 'day', 'days')} left`
}

/** "Xiao sent you a song", or the list's own name. */
export function shareFromLine(link: Pick<ShareLink, 'kind' | 'from' | 'entries'>): string {
  if (link.kind === 'song') return `${link.from.name} sent you a song`
  return `${link.from.name} sent you ${plural(link.entries.length, 'song', 'songs')}`
}

/**
 * The top line of a link's page, beside its sender's face: who sent it, then
 * how long it has, apart so the time can turn amber on its last day. Your own
 * link says who opened it instead.
 */
export function shareHeadLine(link: ShareLink, now: number): { from: string; time: string } {
  if (link.yours) {
    return {
      from: 'Your link',
      time: sentLine({ ...link, songs: link.entries.length, cover: null }, now),
    }
  }
  return { from: shareFromLine(link), time: shareTimeLine(link, now) }
}

/**
 * The words that go with a link (D2): "干杯 · 五月天" for a song, "五月天 精选 ·
 * 12 songs" for a list. The link goes beside them, not inside them, so it is
 * sent once (ports/shareLink).
 */
export function shareWords({
  name,
  kind,
  artist,
  songs,
}: {
  name: string
  kind: 'song' | 'list'
  /** The song's artist, when it is known. */
  artist: string | null
  /** How many songs the link holds. */
  songs: number
}): string {
  if (kind === 'list') return `${name} · ${plural(songs, 'song', 'songs')}`
  const by = artist?.trim()
  return by ? `${name} · ${by}` : name
}

/**
 * Profile's line under Links you shared (F2): how many still play, and how many
 * friends asked for more, or what the row is while the list is on its way.
 */
export function sentLinksHint(links: readonly ShareSummary[] | undefined, now: number): string {
  if (links === undefined) return 'Songs you sent as links'
  if (links.length === 0) return 'None yet. Share link is in a song’s ⋯ menu'
  const live = links.filter(link => shareStage(link, now) !== 'ended').length
  const asks = links.reduce((sum, link) => sum + link.asks.length, 0)
  return [
    live > 0 ? `${plural(live, 'link', 'links')} playing` : 'None playing',
    asks > 0 ? `${plural(asks, 'friend asks', 'friends ask')} again` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Who opened a link of yours: "Opened by Ken, Mia and 2 more", "Opened 3 times", "Not opened yet". */
function openedLine(link: ShareSummary): string {
  const names = link.opened.slice(0, 3)
  const more = link.opened.length - names.length + link.guests
  if (names.length > 0) return `Opened by ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
  return link.guests > 0 ? `Opened ${plural(link.guests, 'time', 'times')}` : 'Not opened yet'
}

/** A link in your Links you shared (F2): who opened it, and how long it has. */
export function sentLine(link: ShareSummary, now: number): string {
  const stage = shareStage(link, now)
  const who = openedLine(link)
  if (stage === 'ended') {
    if (link.ended?.why === 'removed') return 'Ended · no longer in your library'
    const played = link.plays > 0 ? ` · played ${plural(link.plays, 'time', 'times')}` : ''
    return `Ended ${shortDate(link.ended?.at ?? link.endsAt)}${played}`
  }
  if (stage === 'lastDay') return `${who} · ${endingWords(link.endsAt, now).toLowerCase()}`
  return `${who} · ${plural(daysLeft(link.endsAt, now), 'day', 'days')} left`
}

/**
 * Links you shared, in its two sections (C3): the ones still playing, soonest
 * to end first, so the one on its last day is on top (G1); then the ones that
 * have ended, the latest first.
 */
export function sentSections(
  links: readonly ShareSummary[],
  now: number,
): { playing: ShareSummary[]; ended: ShareSummary[] } {
  const over = (link: ShareSummary): boolean => shareStage(link, now) === 'ended'
  const endedAt = (link: ShareSummary): number => link.ended?.at ?? link.endsAt
  return {
    playing: links.filter(link => !over(link)).sort((a, b) => a.endsAt - b.endsAt),
    ended: links.filter(over).sort((a, b) => endedAt(b) - endedAt(a)),
  }
}

/** How many ended links show before the rest fold away under "Show 3 more" (J2). */
export const ENDED_SHOWN = 5

/** The line under Links you shared's title (F): "11 links · 3 playing". */
export function sentCountLine(links: readonly ShareSummary[], now: number): string {
  const playing = links.filter(link => shareStage(link, now) !== 'ended').length
  return `${plural(links.length, 'link', 'links')} · ${playing > 0 ? `${playing} playing` : 'none playing'}`
}

/**
 * A link's second line on a computer, beside its time column (A1): who opened
 * it while it plays, and how much it played once it is over.
 */
export function sentSub(link: ShareSummary, now: number): string {
  if (shareStage(link, now) === 'ended') {
    if (link.ended?.why === 'removed') return 'No longer in your library'
    return link.plays > 0 ? `Played ${plural(link.plays, 'time', 'times')}` : 'Never played'
  }
  return openedLine(link)
}

/** Its time column (A1), where a song's length would be: "6 days left", "Ends tonight", "Ended Oct 20". */
export function sentTime(link: ShareSummary, now: number): string {
  const line = shareTimeLine(link, now)
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/**
 * Asking before removing ticked links (D3): playing ones are taken too, and
 * stop for whoever has them.
 */
export function removeLinksWords(
  links: readonly ShareSummary[],
  now: number,
): { title: string; body: string } {
  const playing = links.filter(link => shareStage(link, now) !== 'ended').length
  const one = links.length === 1
  const pages = one ? 'Its page goes too.' : 'Their pages go too.'
  const stopping =
    playing === 0
      ? ''
      : one
        ? 'It is still playing and stops for everyone. '
        : playing === 1
          ? '1 of them is still playing and stops for everyone. '
          : `${playing} of them are still playing and stop for everyone. `
  return {
    title: one ? 'Remove this link?' : `Remove ${links.length} links?`,
    body: `${stopping}${pages}`,
  }
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
