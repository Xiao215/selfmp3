import {
  cleanArtist,
  neteaseAlbumUrl,
  neteaseLink,
  neteaseSongUrl,
  withoutRepeats,
  type NeteaseLink,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'

/**
 * 网易云音乐: its songs, albums, playlists and artists, and its lyrics.
 *
 * The web API its own site uses, without signing in. The audio itself is
 * downloaded by yt-dlp, which reads 网易云 links (importQueue.ts); this reads
 * the lists, says which songs 网易云 will give out whole, and fetches the
 * words for a song that came from here.
 *
 * Whole or not is the part that matters. Asked for a VIP song — most of a
 * chart — or one it may not play in this country, 网易云 does not refuse: it
 * hands over thirty to forty-five seconds, and yt-dlp downloads that as the
 * song. The song's `privileges` say what this server may play (`pl`, the
 * bitrate, 0 for none), so such a song is found on YouTube instead, before
 * anything is downloaded.
 *
 * Every request says it comes from the mainland. Many songs are free there
 * and locked everywhere else, and yt-dlp downloads them whole by saying the
 * same (it retries a geo-restricted 网易云 song from a Chinese address), so
 * asking from here would send songs to YouTube that 网易云 would give out.
 */

const API = 'https://music.163.com/api/'
const REQUEST_TIMEOUT_MS = 10_000
/**
 * A mainland address, sent as X-Real-IP: the header 网易云's API reads where
 * a request comes from (it ignores X-Forwarded-For).
 */
const MAINLAND_ADDRESS = '116.25.146.177'
/** Songs asked about in one request. */
const DETAIL_CHUNK = 400
/** Cover size asked of the picture host: square, and plenty for a cover. */
const COVER_PARAM = '?param=1000y1000'
/** A search result's cover is a row's thumbnail: small, so a list of them arrives at once. */
const THUMB_PARAM = '?param=200y200'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** One 网易云 song, as a review shows it. */
export interface NeteaseTrack {
  readonly url: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number
  readonly thumbnail: string | null
  /** Whether 网易云 gives this server the whole song. */
  readonly free: boolean
}

/** One 网易云 album, as a search lists it. */
interface NeteaseAlbum {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly artist: string
  /** How many songs it has. */
  readonly tracks: number
  readonly cover: string | null
}

export interface NeteaseList {
  readonly title: string | null
  readonly tracks: NeteaseTrack[]
}

/** A song's words from 网易云: timed LRC, or a song it says has none. */
type NeteaseLyrics = { readonly text: string } | 'instrumental' | null

interface SongJson {
  id?: number
  name?: string
  dt?: number
  ar?: { name?: string }[]
  al?: { name?: string; picUrl?: string }
}

interface PrivilegeJson {
  id?: number
  /** The bitrate this server may play; 0 when it may not play the song at all. */
  pl?: number
  /** Below 0 when the song is greyed out where the request came from. */
  st?: number
}

export class NeteaseMusic {
  readonly #logger: Logger
  readonly #fetch: FetchLike

  constructor(logger: Logger, fetchImpl: FetchLike = fetch) {
    this.#logger = logger.child('netease')
    this.#fetch = fetchImpl
  }

  /**
   * What a pasted 网易云 link opens, following a short `163cn.tv` link to the
   * page it stands for. Null when it opens nothing this can read.
   */
  async link(url: string): Promise<NeteaseLink | null> {
    const direct = neteaseLink(url)
    if (direct) return direct
    if (!/^https?:\/\/163cn\.tv\//i.test(url)) return null
    try {
      const response = await this.#fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const location = response.headers.get('location')
      return location ? neteaseLink(location) : null
    } catch {
      return null
    }
  }

  /** The songs a link opens. Throws with a reason a person can act on. */
  async list(link: NeteaseLink): Promise<NeteaseList> {
    if (link.kind === 'song') {
      return { title: null, tracks: await this.#tracks([link.id]) }
    }
    if (link.kind === 'album') {
      const page = (await this.#get(`v1/album/${link.id}`)) as {
        album?: { name?: string }
        songs?: SongJson[]
      } | null
      const ids = idsOf(page?.songs)
      if (!page || ids.length === 0) throw new Error(UNREADABLE)
      return { title: page.album?.name ?? null, tracks: await this.#tracks(ids) }
    }
    if (link.kind === 'artist') {
      // The fifty songs the artist's page lists first, most played first: what
      // a YouTube artist link means too (youtubeMusicArtist.ts).
      const page = (await this.#get(`artist/${link.id}`)) as {
        artist?: { name?: string }
        hotSongs?: SongJson[]
      } | null
      const ids = idsOf(page?.hotSongs)
      if (!page || ids.length === 0) throw new Error(UNREADABLE)
      return { title: page.artist?.name ?? null, tracks: await this.#tracks(ids) }
    }
    const page = (await this.#get(`v6/playlist/detail?id=${link.id}&n=100000`)) as {
      playlist?: { name?: string; trackIds?: { id?: number }[] }
    } | null
    const ids = idsOf(page?.playlist?.trackIds)
    if (!page?.playlist || ids.length === 0) throw new Error(UNREADABLE)
    return { title: page.playlist.name ?? null, tracks: await this.#tracks(ids) }
  }

  /**
   * Songs 网易云 lists for some words, best first: the search its own site's
   * app uses. Its names are the publisher's, often in two languages
   * ("丹砂巍巍 Wordless Cliffs"). Empty when it did not answer.
   */
  async search(words: string, limit = 8): Promise<NeteaseTrack[]> {
    const page = (await this.#post('cloudsearch/pc', {
      s: words,
      type: '1',
      limit: String(limit),
      offset: '0',
    })) as { result?: { songs?: SongJson[] } } | null
    return toTracks(page?.result?.songs ?? [], [])
  }

  /** Albums 网易云 lists for some words, best first; empty when it did not answer. */
  async searchAlbums(words: string, limit = 5): Promise<NeteaseAlbum[]> {
    const page = (await this.#post('cloudsearch/pc', {
      s: words,
      type: '10',
      limit: String(limit),
      offset: '0',
    })) as {
      result?: {
        albums?: {
          id?: number
          name?: string
          size?: number
          picUrl?: string
          artist?: { name?: string }
          artists?: { name?: string }[]
        }[]
      }
    } | null
    return (page?.result?.albums ?? []).flatMap(album => {
      if (typeof album.id !== 'number' || !album.name?.trim()) return []
      const artists = (album.artists ?? (album.artist ? [album.artist] : []))
        .map(each => each.name?.trim() ?? '')
        .filter(Boolean)
      const picture = album.picUrl?.replace(/^http:/, 'https:')
      return [
        {
          id: String(album.id),
          url: neteaseAlbumUrl(String(album.id)),
          title: album.name.trim(),
          artist: artists.join(', '),
          tracks: album.size ?? 0,
          cover: picture ? `${picture}${THUMB_PARAM}` : null,
        },
      ]
    })
  }

  /** An album's songs, or none when 网易云 did not answer. */
  async albumTracks(id: string): Promise<NeteaseTrack[]> {
    try {
      return (await this.list({ kind: 'album', id })).tracks
    } catch {
      return []
    }
  }

  /** A song's lyrics, by its id; null when there are none or 网易云 did not answer. */
  async lyrics(id: string): Promise<NeteaseLyrics> {
    const page = (await this.#get(`song/lyric?id=${id}&lv=1`)) as {
      lrc?: { lyric?: string }
      nolyric?: boolean
      pureMusic?: boolean
    } | null
    if (!page) return null
    if (page.pureMusic === true || page.nolyric === true) return 'instrumental'
    const text = withoutCredits(page.lrc?.lyric ?? '')
    if (/^\[[\d:.]+\]\s*纯音乐，请欣赏\s*$/m.test(text) && text.split('\n').length <= 2) {
      return 'instrumental'
    }
    return text.trim() ? { text } : null
  }

  /** Songs and what this server may play of them, in the order asked for. */
  async #tracks(ids: readonly string[]): Promise<NeteaseTrack[]> {
    const tracks: NeteaseTrack[] = []
    for (let start = 0; start < ids.length; start += DETAIL_CHUNK) {
      const chunk = ids.slice(start, start + DETAIL_CHUNK)
      const page = (await this.#post('v3/song/detail', {
        c: JSON.stringify(chunk.map(id => ({ id: Number(id) }))),
      })) as { songs?: SongJson[]; privileges?: PrivilegeJson[] } | null
      if (!page?.songs) throw new Error(UNREADABLE)
      tracks.push(...toTracks(page.songs, page.privileges ?? []))
    }
    return tracks
  }

  async #get(path: string): Promise<unknown> {
    return this.#request(`${API}${path}`, { method: 'GET' })
  }

  async #post(path: string, form: Record<string, string>): Promise<unknown> {
    return this.#request(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
  }

  async #request(url: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await this.#fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          'User-Agent': 'Mozilla/5.0 (Macintosh) self.mp3',
          Referer: 'https://music.163.com/',
          'X-Real-IP': MAINLAND_ADDRESS,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const json = (await response.json()) as { code?: number }
      // The API answers 200 with its own code; anything but 200 there is a refusal.
      return json.code === undefined || json.code === 200 ? json : null
    } catch (error) {
      this.#logger.debug('lookup failed', {
        url,
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}

const UNREADABLE =
  '网易云音乐 did not answer for that link. It may be private, or 网易云 may be busy: try again in a moment.'

function idsOf(list: { id?: number }[] | undefined): string[] {
  return (list ?? []).flatMap(item => (typeof item.id === 'number' ? [String(item.id)] : []))
}

/**
 * Songs with their privileges, as tracks. A song is free when this server may
 * play it at some bitrate and it is not greyed out here: anything less comes
 * out as a preview.
 */
export function toTracks(
  songs: readonly SongJson[],
  privileges: readonly PrivilegeJson[],
): NeteaseTrack[] {
  const allowed = new Map(privileges.map(privilege => [privilege.id, privilege]))
  return songs.flatMap(song => {
    if (typeof song.id !== 'number' || !song.name?.trim()) return []
    const privilege = allowed.get(song.id)
    const picture = song.al?.picUrl?.replace(/^http:/, 'https:')
    return [
      {
        url: neteaseSongUrl(String(song.id)),
        title: song.name.trim(),
        artist: withoutRepeats(
          cleanArtist(
            (song.ar ?? [])
              .map(artist => artist.name?.trim() ?? '')
              .filter(Boolean)
              .join(', '),
          ),
        ),
        album: song.al?.name?.trim() ?? '',
        duration: typeof song.dt === 'number' ? Math.round(song.dt / 1000) : 0,
        thumbnail: picture ? `${picture}${COVER_PARAM}` : null,
        free: (privilege?.pl ?? 0) > 0 && (privilege?.st ?? 0) >= 0,
      },
    ]
  })
}

/** A timed line: its stamps, then its words. */
const TIMED = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/
/** "作词 : 唐恬", "制作人：钱雷", "Producer: X" — a role, a colon, a name. */
const CREDIT = /^[^\s:：]{1,12}\s*[:：]\s*\S/

/**
 * The words without the credits 网易云 writes as lyric lines.
 *
 * Its lyrics open — and often close — with who wrote, arranged, mixed and
 * mastered the song, each as a timed line: "[00:00.463] 作曲 : 钱雷". Shown
 * as words they scroll past as the song's first lines. A credit is a short
 * role, a colon and a name; only a run of them at the start or the end goes,
 * so a sung line with a colon in it ("He said: …") is never taken for one.
 */
export function withoutCredits(lrc: string): string {
  const lines = lrc.split(/\r?\n/)
  const isCredit = (line: string): boolean => {
    const timed = TIMED.exec(line.trim())
    const words = (timed ? (timed[2] ?? '') : line).trim()
    return words.length > 0 && CREDIT.test(words)
  }
  // Untimed header lines ("[by:…]") and blanks are left where they are; only timed credits go.
  const isLyric = (line: string): boolean => TIMED.test(line.trim()) && !isCredit(line)
  const first = lines.findIndex(isLyric)
  if (first === -1) return ''
  let last = lines.length - 1
  while (last > first && !isLyric(lines[last] ?? '')) last--
  const kept = lines.filter(
    (line, index) =>
      (index >= first && index <= last) || (!TIMED.test(line.trim()) && line.trim() !== ''),
  )
  return kept.join('\n').trim()
}
