import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { artistKey, splitArtists, type Song } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import { YouTubeMusicApi, type FetchLike } from './youtubeMusicApi.js'
import type { YouTubeMusicArtists } from './youtubeMusicArtist.js'
import { fits, isSameSong, searchSongs } from './youtubeMusicSongs.js'

/**
 * An artist's picture, from their page on YouTube Music.
 *
 * An artist here is what the songs say, so there is nothing to look one up
 * by but a name — and YouTube Music's search never says "no such artist"; it
 * answers "Unknown Artist" with somebody, and a banner to go with them. So
 * the page is found through the songs instead: a search for each of a few
 * songs this library has by the artist names, beside each hit, the artist's
 * page it belongs to, and the page the songs agree on is the artist's. Songs
 * that name different pages, or none, mean no picture — an honest blank
 * rather than a stranger's face.
 *
 * A hit is the song when its title and length are (youtubeMusicSongs.ts).
 * Its artist is not compared: the search was for this artist's name, and a
 * hit writes the artist as YouTube Music does — ヨルシカ for a library's
 * Yorushika — so the page is the better witness. Only where there is a
 * single song to ask is more wanted of it: its hit naming the artist, or its
 * length being known and the song naming this artist alone. One song of no
 * known length, of a title a hundred channels share, cannot vouch for a
 * page; nor can a song that names the artist as a guest — "n-buna feat.
 * suis" is a witness for n-buna's page, not for suis's.
 *
 * Fetched once and kept, as a cover is: under `data/artists/`, disposable,
 * rebuilt on the next ask if deleted. An artist found to have no picture is
 * remembered for a while too, so an artist page does not go out to YouTube
 * Music every time it is opened.
 */

/** Songs asked about per artist. Each is one request; agreement needs two. */
const SONGS_ASKED = 3

/** How long "no picture for this artist" is believed before it is asked again. */
const NONE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The size kept. The page offers it at up to 2880×1200; drawn at a page's
 * width under a fade, this is sharp on a 2× screen at about 125 KB.
 */
const BACKDROP_SIZE = { width: 1200, height: 500 }

const REQUEST_TIMEOUT_MS = 10_000

interface KeptBackdrop {
  readonly path: string
  readonly contentType: 'image/jpeg'
  /** Names this copy, for the address it is drawn from; changes with the file. */
  readonly rev: string
}

export class ArtistBackdropService {
  readonly #dir: string
  readonly #songs: Pick<SongRepository, 'all'>
  readonly #youtube: Pick<YouTubeMusicArtists, 'backdrop'>
  readonly #api: YouTubeMusicApi
  readonly #fetch: FetchLike
  readonly #logger: Logger
  /** Artists being looked for, so two pages opening at once share the work. */
  readonly #finding = new Map<string, Promise<KeptBackdrop | null>>()

  constructor(
    config: Config,
    songs: Pick<SongRepository, 'all'>,
    youtube: Pick<YouTubeMusicArtists, 'backdrop'>,
    logger: Logger,
    fetchImpl: FetchLike = fetch,
  ) {
    this.#dir = path.join(config.dataDir, 'artists')
    this.#songs = songs
    this.#youtube = youtube
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
    this.#fetch = fetchImpl
    this.#logger = logger.child('artist-backdrops')
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  /** The picture kept for this artist, without asking anyone. */
  kept(name: string): KeptBackdrop | null {
    const file = this.#file(artistKey(name), '.jpg')
    try {
      const stat = fs.statSync(file)
      return { path: file, contentType: 'image/jpeg', rev: Math.floor(stat.mtimeMs).toString(16) }
    } catch {
      return null
    }
  }

  /** The kept picture, or one found now; null when there is none to be had. */
  async find(name: string): Promise<KeptBackdrop | null> {
    const kept = this.kept(name)
    if (kept) return kept
    const key = artistKey(name)
    if (!key || this.#saidNoneLately(key)) return null

    let finding = this.#finding.get(key)
    if (!finding) {
      finding = this.#find(name, key).finally(() => this.#finding.delete(key))
      this.#finding.set(key, finding)
    }
    return finding
  }

  async #find(name: string, key: string): Promise<KeptBackdrop | null> {
    const channelId = await this.#pageOf(name, key)
    // Undefined is "could not ask", which is not worth remembering for a week.
    if (channelId === undefined) return null
    const url = channelId ? await this.#youtube.backdrop(channelId, BACKDROP_SIZE) : null
    if (!url) {
      await this.#rememberNone(key)
      return null
    }
    const bytes = await this.#download(url)
    if (!bytes) return null
    return this.#keep(key, bytes)
  }

  /**
   * The artist's page, through the songs: the one the songs this library has
   * by them agree on. Null when they do not, undefined when YouTube Music
   * could not be asked.
   */
  async #pageOf(name: string, key: string): Promise<string | null | undefined> {
    const songs = this.#songs
      .all()
      .filter(song => splitArtists(song.artist).some(named => artistKey(named) === key))
      // A song whose length is known is a stronger witness: its hit has to be as long.
      .sort((a, b) => Number(b.duration > 0) - Number(a.duration > 0))
      .slice(0, SONGS_ASKED)
    if (songs.length === 0) return null

    // Each song is one request to the search; they go out together.
    const results = await Promise.all(songs.map(song => this.#hitsFor(name, song)))
    if (results.some(hits => hits === null)) return undefined

    const pages = new Map<string, { songs: number; named: boolean }>()
    for (const hits of results) {
      if (hits === null) continue
      const counted = new Set<string>()
      for (const hit of hits) {
        const page = pages.get(hit.page) ?? { songs: 0, named: false }
        if (!counted.has(hit.page)) {
          page.songs += 1
          counted.add(hit.page)
        }
        page.named ||= hit.namesArtist
        pages.set(hit.page, page)
      }
    }

    const ranked = [...pages.entries()].sort((a, b) => b[1].songs - a[1].songs)
    const [best, second] = ranked
    if (!best) return null
    // Agreement: named by more than one song and by more than any other page —
    // or by the only song there was to ask, which named nothing else, where
    // its hit names the artist or its length is known and the artist is its
    // only one.
    if (best[1].songs >= 2 && best[1].songs > (second?.[1].songs ?? 0)) return best[0]
    if (songs.length === 1 && ranked.length === 1) {
      const [song] = songs
      const alone = song !== undefined && splitArtists(song.artist).length === 1
      if (best[1].named || (alone && song.duration > 0)) return best[0]
    }
    return null
  }

  /**
   * The pages the search's hits for this song belong to, and whether the hit
   * writes the artist's name as this library does; null when the search
   * could not be asked.
   */
  async #hitsFor(
    artist: string,
    song: Song,
  ): Promise<{ page: string; namesArtist: boolean }[] | null> {
    const lookup = { artist, title: song.title, duration: song.duration }
    const tracks = await searchSongs(this.#api, lookup)
    if (tracks === null) return null
    const hits: { page: string; namesArtist: boolean }[] = []
    for (const track of tracks) {
      if (!track.audioTrack || !track.artistChannelId) continue
      if (!isSameSong(track, { ...lookup, artist: '' }) || !fits(track, song.duration)) continue
      hits.push({ page: track.artistChannelId, namesArtist: isSameSong(track, lookup) })
    }
    return hits
  }

  async #download(url: string): Promise<Buffer | null> {
    try {
      const response = await this.#fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!response.ok) return null
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      this.#logger.debug('could not fetch the picture', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Written under a name of its own and renamed into place, so the real name
   * only ever holds a whole file (as covers.ts makes a thumbnail).
   */
  async #keep(key: string, bytes: Buffer): Promise<KeptBackdrop | null> {
    const file = this.#file(key, '.jpg')
    const partial = `${file}.${randomUUID()}.partial`
    try {
      await fsp.writeFile(partial, bytes)
      await fsp.rename(partial, file)
      await fsp.rm(this.#file(key, '.none'), { force: true })
      const stat = await fsp.stat(file)
      return { path: file, contentType: 'image/jpeg', rev: Math.floor(stat.mtimeMs).toString(16) }
    } catch (error) {
      await fsp.rm(partial, { force: true }).catch(() => undefined)
      // Missing is cosmetic: the page is lit by a song's cover instead.
      this.#logger.warn('could not keep the picture', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  #saidNoneLately(key: string): boolean {
    try {
      return Date.now() - fs.statSync(this.#file(key, '.none')).mtimeMs < NONE_TTL_MS
    } catch {
      return false
    }
  }

  async #rememberNone(key: string): Promise<void> {
    await fsp.writeFile(this.#file(key, '.none'), '').catch(() => undefined)
  }

  /** Named by a hash of the key: an artist's name is any script, a file's name is not. */
  #file(key: string, extension: string): string {
    const hash = createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 16)
    return path.join(this.#dir, `${hash}${extension}`)
  }
}
