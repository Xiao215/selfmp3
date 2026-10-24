import { z } from 'zod'
import {
  DAY_MS,
  artistKey,
  formatHlc,
  libraryArtists,
  tidyArtistNames,
  type Artist,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { NamesRepository } from '../repositories/names.js'
import type { SongRepository } from '../repositories/songs.js'
import type { FetchLike } from './fetching.js'
import { getJson, luceneEscape, type ProviderDeps } from './lookup.js'
import type { RateLimiter } from './rateLimiter.js'

/**
 * The names an artist also goes by, from MusicBrainz, so search finds 周杰伦
 * typed as "Jay Chou" and 幾田りら as "ikura" (packages/shared/src/searchNames.ts).
 *
 * An artist here is what the songs say, so they are found by name: a search
 * of MusicBrainz's artists, and the one hit that is written that way — as its
 * name, its sort name or one of its aliases. Two hits written that way are two
 * different people, and neither is guessed at: an honest nothing, as a picture
 * no songs agree on is (services/artistBackdrops.ts). The artist found is then
 * read whole, for every alias and for the names it performs under or as
 * (MusicBrainz's "is person": 幾田りら sings in YOASOBI as ikura).
 *
 * What is found is the library's as if somebody had typed it on the artist's
 * page, stamped as the earliest change there could be, so that anything a
 * person did there — before or after, on any device — wins. It is filled in
 * only for an artist nobody has named, and only once: an artist found to have
 * none is asked about again after a while, since MusicBrainz grows.
 */

/** How long "MusicBrainz knows no other names for this artist" is believed. */
const NONE_TTL_MS = 30 * DAY_MS

/** Hits looked through for the one written as the library writes the artist. */
const HITS = 5

/** Names in scripts a person searching here would type: Latin, Chinese and Japanese. */
const TYPED =
  /^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}\p{P}\p{S}\p{Zs}\p{M}]+$/u

const AliasSchema = z.object({ name: z.string() })

const HitSchema = z.object({
  id: z.string(),
  name: z.string(),
  'sort-name': z.string().optional(),
  aliases: z.array(AliasSchema).optional(),
})

const SearchSchema = z.object({ artists: z.array(HitSchema) })

const ArtistSchema = HitSchema.extend({
  relations: z
    .array(
      z.object({
        type: z.string(),
        artist: z.object({ name: z.string() }).optional(),
      }),
    )
    .optional(),
})

type Hit = z.infer<typeof HitSchema>

/** "Chou, Jay" → "Chou Jay": the order a sort name gives, which is how East Asian names are said. */
function unsorted(sortName: string): string {
  return sortName.replace(/,\s*/g, ' ')
}

/** Every way a hit is written, for telling whether it is the artist asked about. */
function writings(hit: Hit): string[] {
  return [
    hit.name,
    ...(hit['sort-name'] ? [hit['sort-name'], unsorted(hit['sort-name'])] : []),
  ].concat((hit.aliases ?? []).map(alias => alias.name))
}

/** The one hit written as the artist is, or null when none is, or more than one. */
function theArtist(hits: readonly Hit[], name: string): Hit | null {
  const key = artistKey(name)
  const same = hits.filter(hit => writings(hit).some(written => artistKey(written) === key))
  return same.length === 1 ? (same[0] ?? null) : null
}

/** The names worth keeping from an artist as MusicBrainz has them, the artist's own left out. */
function namesOf(found: z.infer<typeof ArtistSchema>, name: string): string[] {
  const performing = (found.relations ?? [])
    .filter(relation => relation.type === 'is person')
    .flatMap(relation => (relation.artist ? [relation.artist.name] : []))
  const sortName = found['sort-name']
  const all = [
    found.name,
    ...performing,
    ...(found.aliases ?? []).map(alias => alias.name),
    ...(sortName ? [unsorted(sortName)] : []),
  ]
  return tidyArtistNames(
    name,
    all.filter(written => TYPED.test(written)),
  )
}

export class ArtistNameLookup {
  readonly #names: NamesRepository
  readonly #songs: Pick<SongRepository, 'all'>
  readonly #deviceId: () => string
  readonly #pace: RateLimiter
  readonly #deps: ProviderDeps
  readonly #logger: Logger
  readonly #now: () => number
  #filling: Promise<number> | null = null

  constructor(deps: {
    names: NamesRepository
    songs: Pick<SongRepository, 'all'>
    /** This server's device id, which the stamp of what it finds carries. */
    deviceId: () => string
    /** MusicBrainz's pace, the machine's (shared.ts). */
    pace: RateLimiter
    logger: Logger
    fetch?: FetchLike
    now?: () => number
  }) {
    this.#names = deps.names
    this.#songs = deps.songs
    this.#deviceId = deps.deviceId
    this.#pace = deps.pace
    this.#logger = deps.logger.child('artist-names')
    this.#deps = { fetch: deps.fetch ?? fetch, logger: this.#logger }
    this.#now = deps.now ?? Date.now
  }

  /**
   * Look up every artist of the library nobody has named, most songs first,
   * one at a time at MusicBrainz's pace. One run however often it is asked: a
   * second call while one runs joins it. Stops at the first question
   * MusicBrainz does not answer, to ask again after the next pass.
   *
   * Returns how many artists it found names for.
   */
  fill(): Promise<number> {
    this.#filling ??= this.#fill().finally(() => {
      this.#filling = null
    })
    return this.#filling
  }

  async #fill(): Promise<number> {
    let found = 0
    for (const artist of libraryArtists(this.#songs.all())) {
      if (this.#names.artistNamed(artist.key)) continue
      const looked = this.#names.lookedAt(artist.key)
      if (looked !== null && this.#now() - looked < NONE_TTL_MS) continue
      const names = await this.#lookUp(artist)
      if (names === null) break
      this.#names.markLookedUp(artist.key, new Date(this.#now()))
      if (names.length === 0) continue
      // The earliest stamp there is: whatever a person sets, wherever, wins.
      const hlc = formatHlc({ ms: 0, counter: 0, device: this.#deviceId() })
      if (this.#names.takeArtistNames(artist.key, names, hlc)) found++
    }
    if (found > 0) this.#logger.info('found the names artists also go by', { artists: found })
    return found
  }

  /** The artist's other names; empty for none found, null when MusicBrainz did not answer. */
  async #lookUp(artist: Artist): Promise<string[] | null> {
    const query = luceneEscape(artist.name)
    if (!query) return []
    const params = new URLSearchParams({ query, fmt: 'json', limit: String(HITS) })
    await this.#pace.acquire()
    const searched = await getJson(
      this.#deps,
      `https://musicbrainz.org/ws/2/artist?${params.toString()}`,
    )
    if (searched === null) return null
    const hits = SearchSchema.safeParse(searched)
    if (!hits.success) return null
    const hit = theArtist(hits.data.artists, artist.name)
    if (!hit) return []

    await this.#pace.acquire()
    const read = await getJson(
      this.#deps,
      `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(hit.id)}?inc=aliases+artist-rels&fmt=json`,
    )
    if (read === null) return null
    const whole = ArtistSchema.safeParse(read)
    return whole.success ? namesOf(whole.data, artist.name) : null
  }
}
