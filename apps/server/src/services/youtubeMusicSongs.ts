import { findAll, findKey, runs, WEB_CLIENT, type YouTubeMusicApi } from './youtubeMusicApi.js'

/**
 * Songs on YouTube Music as its search names them, and whether one of them
 * is the song a file holds. Two things here go looking for a song there and
 * share these: its timed lyrics (youtubeMusic.ts) and its artist's own page
 * (artistBackdrops.ts), which is found through the songs rather than the name.
 */

/** The search's "Songs" filter: studio tracks only, no videos or playlists. */
export const SONGS_ONLY = 'EgWKAQIIAWoMEA4QChADEAQQCRAF'

/**
 * How far the track's length may be from the file's for it to be the same
 * recording — the same second as lrclib gets. YouTube Music shows lengths in
 * whole seconds, rounded up (a 248.06 s download shows as 4:09), so a track
 * shown as L seconds is anywhere from L − 1 to L long.
 */
export const LENGTH_TOLERANCE_S = 1

/** The one kind of entry whose timings match a download: the studio audio, not a video. */
export const AUDIO_TRACK = 'MUSIC_VIDEO_TYPE_ATV'

/** A title naming another cut of the song, which the song itself does not. */
const OTHER_VERSION =
  /\b(?:version|ver\.|remix|live|instrumental|inst\.|acoustic|karaoke|off vocal|cover|sped up|slowed)\b/i

export interface SongLookup {
  readonly artist: string
  readonly title: string
  /** Seconds, from the file; 0 when unknown. */
  readonly duration: number
}

export interface Track {
  readonly videoId: string
  readonly title: string
  readonly artist: string
  /** The artist's channel (`UC…`), where the row links to one. */
  readonly artistChannelId: string | null
  readonly audioTrack: boolean
  /** Whole seconds as shown, or null. */
  readonly length: number | null
}

/**
 * Every song the search lists for "artist title", as listed; null when the
 * search could not be asked, which is not the same as it listing nothing.
 */
export async function searchSongs(
  api: YouTubeMusicApi,
  input: SongLookup,
): Promise<Track[] | null> {
  const query = `${input.artist} ${input.title}`.trim()
  const response = await api.post('search', { query, params: SONGS_ONLY }, WEB_CLIENT)
  if (!response) return null

  const tracks: Track[] = []
  for (const item of findAll(response, 'musicResponsiveListItemRenderer')) {
    const videoId = findKey((item as Record<string, unknown>)['playlistItemData'], 'videoId')
    if (typeof videoId !== 'string') continue
    // Column one is the title; column two reads "Artist • Album • 3:27", and
    // the artist in it links to the artist's page.
    const columns = findAll(item, 'musicResponsiveListItemFlexColumnRenderer')
    const texts = columns.map(column => runs((column as Record<string, unknown>)['text']).join(''))
    const details = (texts[1] ?? '').split(' • ')
    const artistChannelId = findAll(columns[1], 'browseEndpoint')
      .map(endpoint => (endpoint as { browseId?: unknown }).browseId)
      .find((id): id is string => typeof id === 'string' && id.startsWith('UC'))
    tracks.push({
      videoId,
      title: texts[0] ?? '',
      artist: details[0] ?? '',
      artistChannelId: artistChannelId ?? null,
      audioTrack: findKey(item, 'musicVideoType') === AUDIO_TRACK,
      length: parseLength(details.at(-1) ?? ''),
    })
  }
  return tracks
}

/** Seconds between the file and the track, allowing for the rounded-up length. */
export function lengthGap(track: Track, duration: number): number {
  if (duration <= 0) return 0
  if (track.length === null) return Number.POSITIVE_INFINITY
  if (duration > track.length) return duration - track.length
  if (duration < track.length - 1) return track.length - 1 - duration
  return 0
}

export function fits(track: Track, duration: number): boolean {
  return lengthGap(track, duration) <= LENGTH_TOLERANCE_S
}

/**
 * Same title and artist, give or take how each side writes them: YouTube
 * Music may add a romanized title ("オリオン - Orion"), and a local file may
 * list a featured artist. A title naming another cut — "(English Version)",
 * "(Live)" — is another song for lyrics, unless the file's title says so too.
 */
export function isSameSong(track: Track, input: SongLookup): boolean {
  const title = normalize(track.title)
  const wanted = normalize(input.title)
  if (!title || !wanted || !(title.includes(wanted) || wanted.includes(title))) return false
  if (OTHER_VERSION.test(track.title) && !OTHER_VERSION.test(input.title)) return false

  const artist = normalize(track.artist)
  const wantedArtist = normalize(input.artist)
  return !wantedArtist || artist.includes(wantedArtist) || wantedArtist.includes(artist)
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** "3:27" or "1:02:03" to seconds. */
export function parseLength(text: string): number | null {
  if (!/^\d+(?::\d{2}){1,2}$/.test(text.trim())) return null
  return text
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
}
