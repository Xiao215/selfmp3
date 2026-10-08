import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  DAY_MS,
  artistKey,
  libraryArtists,
  splitArtists,
  type Artist,
  type ArtistPictureShape,
  type Song,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import { readCapped, type FetchLike } from './fetching.js'
import { YouTubeMusicApi } from './youtubeMusicApi.js'
import { pictureAt, type YouTubeMusicArtists } from './youtubeMusicArtist.js'
import { fits, isSameSong, searchSongs } from './youtubeMusicSongs.js'
import { messageOf } from '../util/errors.js'

/**
 * An artist's picture, from their page on YouTube Music: the banner over the
 * artist's page, and the same picture cut square for the round face beside
 * their name in Stats, as YouTube Music cuts it for its own search.
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
 * Fetched once and kept, as a cover is: under `data/artists/`, both shapes
 * together, disposable, rebuilt on the next ask if either is deleted. An artist found to have no picture is
 * remembered for a while too, so an artist page does not go out to YouTube
 * Music every time it is opened.
 *
 * Every artist of the library is looked for, not only those whose page was
 * opened (`fill`), and the cloud pass puts what is kept in the bucket beside
 * the covers, so a device keeps an artist's picture the way it keeps a cover
 * and has it with no server in reach (services/cloudSync.ts).
 */

/** Songs asked about per artist. Each is one request; agreement needs two. */
const SONGS_ASKED = 3

/** How long "no picture for this artist" is believed before it is asked again. */
const NONE_TTL_MS = 7 * DAY_MS

/**
 * The sizes kept. The banner is offered at up to 2880×1200; drawn at a page's
 * width under a fade, 1200 wide is sharp on a 2× screen at about 125 KB. The
 * portrait is drawn 36 points round, so 240 is sharp on a 3× phone at ~15 KB.
 */
const SIZES = {
  banner: { width: 1200, height: 500 },
  portrait: { width: 240, height: 240 },
} as const satisfies Record<ArtistPictureShape, { width: number; height: number }>

const EXTENSIONS: Record<ArtistPictureShape, string> = {
  banner: '.jpg',
  portrait: '.portrait.jpg',
}

const REQUEST_TIMEOUT_MS = 10_000

/**
 * Between two artists looked for by `fill`: each is up to four requests to
 * YouTube Music, and a library's worth at once is the kind of burst that gets
 * a server asked whether it is a robot.
 */
const FILL_PAUSE_MS = 3_000

/**
 * How long an artist YouTube Music could not be asked about is left before
 * `fill` asks again. Not remembered on disk, as "none" is: it says nothing
 * about the artist, only about that moment.
 */
const UNANSWERED_RETRY_MS = DAY_MS / 4

/** A banner is about 125 KB; past this, what came back is not one. */
const MAX_PICTURE_BYTES = 4 * 1024 * 1024

interface KeptPicture {
  readonly path: string
  readonly contentType: 'image/jpeg'
  /** Names this copy, for the address it is drawn from; changes with the file. */
  readonly rev: string
}

export class ArtistBackdropService {
  readonly #dir: string
  readonly #songs: Pick<SongRepository, 'all'>
  readonly #youtube: Pick<YouTubeMusicArtists, 'picture'>
  readonly #api: YouTubeMusicApi
  readonly #fetch: FetchLike
  readonly #logger: Logger
  /** Artists being looked for, so two pages opening at once share the work. */
  readonly #finding = new Map<string, Promise<KeptPicture | null>>()
  /** When `fill` last found YouTube Music unable to answer about an artist, by key. */
  readonly #unanswered = new Map<string, number>()
  #filling: Promise<number> | null = null
  readonly #pause: (ms: number) => Promise<void>

  constructor(
    config: Config,
    songs: Pick<SongRepository, 'all'>,
    youtube: Pick<YouTubeMusicArtists, 'picture'>,
    logger: Logger,
    fetchImpl: FetchLike = fetch,
    pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  ) {
    this.#pause = pause
    this.#dir = path.join(config.dataDir, 'artists')
    this.#songs = songs
    this.#youtube = youtube
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
    this.#fetch = fetchImpl
    this.#logger = logger.child('artist-backdrops')
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  /**
   * The picture kept for this artist in this shape, without asking anyone.
   * Both shapes or neither: one rev names the pair, so a copy kept before
   * portraits were is found again, the pair with it.
   */
  async kept(name: string, shape: ArtistPictureShape = 'banner'): Promise<KeptPicture | null> {
    const key = artistKey(name)
    try {
      const banner = await fsp.stat(this.#file(key, EXTENSIONS.banner))
      await fsp.access(this.#file(key, EXTENSIONS.portrait))
      return {
        path: this.#file(key, EXTENSIONS[shape]),
        contentType: 'image/jpeg',
        rev: Math.floor(banner.mtimeMs).toString(16),
      }
    } catch {
      return null
    }
  }

  /** Every artist the library's songs name, most songs first. */
  artists(): readonly Artist[] {
    return libraryArtists(this.#songs.all())
  }

  /** Both shapes kept for an artist, and the revision naming the pair; null for none. */
  async keptPair(name: string): Promise<{ banner: string; portrait: string; rev: string } | null> {
    const banner = await this.kept(name, 'banner')
    if (!banner) return null
    return {
      banner: banner.path,
      portrait: this.#file(artistKey(name), EXTENSIONS.portrait),
      rev: banner.rev,
    }
  }

  /**
   * Look for a picture of every artist of the library that has none kept, one
   * artist at a time with a pause between, most songs first. One at a time
   * however often it is asked: a second call while one runs joins it.
   *
   * Returns how many artists it found a picture for.
   */
  fill(): Promise<number> {
    this.#filling ??= this.#fill().finally(() => {
      this.#filling = null
    })
    return this.#filling
  }

  async #fill(): Promise<number> {
    let found = 0
    let asked = false
    for (const artist of this.artists()) {
      if (await this.kept(artist.key)) continue
      if (await this.#saidNoneLately(artist.key)) continue
      const unanswered = this.#unanswered.get(artist.key)
      if (unanswered !== undefined && Date.now() - unanswered < UNANSWERED_RETRY_MS) continue
      if (asked) await this.#pause(FILL_PAUSE_MS)
      asked = true
      if (await this.find(artist.name)) {
        found++
        this.#unanswered.delete(artist.key)
      } else if (!(await this.#saidNoneLately(artist.key))) {
        // Not "none", which `find` remembers: YouTube Music did not answer.
        this.#unanswered.set(artist.key, Date.now())
      }
    }
    if (found > 0) this.#logger.info('found artists’ pictures', { artists: found })
    return found
  }

  /** The kept picture, or one found now; null when there is none to be had. */
  async find(name: string): Promise<KeptPicture | null> {
    const kept = await this.kept(name)
    if (kept) return kept
    const key = artistKey(name)
    if (!key || (await this.#saidNoneLately(key))) return null

    let finding = this.#finding.get(key)
    if (!finding) {
      finding = this.#find(name, key).finally(() => this.#finding.delete(key))
      this.#finding.set(key, finding)
    }
    return finding
  }

  async #find(name: string, key: string): Promise<KeptPicture | null> {
    const channelId = await this.#pageOf(name, key)
    // Undefined is "could not ask", which is not worth remembering for a week.
    if (channelId === undefined) return null
    const address = channelId ? await this.#youtube.picture(channelId) : null
    if (!address) {
      await this.#rememberNone(key)
      return null
    }
    const [banner, portrait] = await Promise.all([
      this.#download(pictureAt(address, SIZES.banner)),
      this.#download(pictureAt(address, SIZES.portrait)),
    ])
    if (!banner || !portrait) return null
    return this.#keep(key, { banner, portrait })
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
      return await readCapped(response, MAX_PICTURE_BYTES)
    } catch (error) {
      this.#logger.debug('could not fetch the picture', {
        message: messageOf(error),
      })
      return null
    }
  }

  /**
   * Each written under a name of its own and renamed into place, so the real
   * name only ever holds a whole file (as covers.ts makes a thumbnail). The
   * banner goes last: it is what `kept` dates the pair by.
   */
  async #keep(key: string, bytes: Record<ArtistPictureShape, Buffer>): Promise<KeptPicture | null> {
    const partials: string[] = []
    try {
      for (const shape of ['portrait', 'banner'] as const) {
        const file = this.#file(key, EXTENSIONS[shape])
        const partial = `${file}.${randomUUID()}.partial`
        partials.push(partial)
        await fsp.writeFile(partial, bytes[shape])
        await fsp.rename(partial, file)
      }
      await fsp.rm(this.#file(key, '.none'), { force: true })
      const stat = await fsp.stat(this.#file(key, EXTENSIONS.banner))
      return {
        path: this.#file(key, EXTENSIONS.banner),
        contentType: 'image/jpeg',
        rev: Math.floor(stat.mtimeMs).toString(16),
      }
    } catch (error) {
      await Promise.all(
        partials.map(partial => fsp.rm(partial, { force: true }).catch(() => undefined)),
      )
      // Missing is cosmetic: the page is lit by a song's cover instead.
      this.#logger.warn('could not keep the picture', {
        message: messageOf(error),
      })
      return null
    }
  }

  async #saidNoneLately(key: string): Promise<boolean> {
    try {
      return Date.now() - (await fsp.stat(this.#file(key, '.none'))).mtimeMs < NONE_TTL_MS
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
