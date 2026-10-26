import {
  plural,
  artistKey,
  joinedNames,
  NO_JOINS,
  splitArtists,
  type ArtistJoinNames,
  type Song,
} from '@selfmp3/shared'
import { untaggedSongs, type TagStanding } from '../tag/tag.model'

/**
 * All tags, without the screen (docs/ui-mock `P07`).
 *
 * The rows themselves — their order, their line, the untagged card's title —
 * are the tag model's (`features/tag/tag.model.ts`), because Home's tiles and
 * a tag's own page count the same way. What is left here is the page's own
 * words, and how the page lays the tags out.
 */

/** "8 tags", under the title, or what to say when there are none. */
export function tagsHeadline(count: number): string {
  if (count === 0) return 'No tags yet'
  return plural(count, 'tag', 'tags')
}

/** A tag with this many songs or fewer waits at the end, under "Just started". */
const JUST_STARTED_MAX = 2

/** One tile of the page: a tag, and the tags it holds. */
export interface TagEntry {
  readonly standing: TagStanding
  /** Tags every one of whose songs this tag also carries, most played first. */
  readonly inside: readonly TagStanding[]
}

/**
 * The page's two runs of tiles (Xiao's picks E and L, 2026-10-02).
 *
 * A tag whose every song another, bigger tag also carries hangs off that tag
 * as a chip under its tile (AG1) rather than standing beside it: the four
 * regions of a game under the game's tag. Nothing is set up for this and
 * nothing is stored; it follows the songs, so a region that gains a song from
 * elsewhere steps back out on its own. The
 * holder is the biggest such tag, which can never itself be inside another
 * (anything holding it would be bigger, and would hold the region too), so
 * there is only ever one level. Two tags on exactly the same songs stay side
 * by side: neither is the bigger. An empty tag is inside nothing.
 *
 * What is left is split by size: tags with a song or two wait at the end, so
 * the page opens on the ones in use, and tags with none after them, on their
 * own: an empty tag had been filed as "a song or two so far". `standings`
 * keeps its order in every run and inside each holder.
 */
export function tagsLayout(standings: readonly TagStanding[]): {
  readonly main: readonly TagEntry[]
  readonly justStarted: readonly TagEntry[]
  readonly empty: readonly TagEntry[]
} {
  const sets = new Map(standings.map(s => [s.tag.id, new Set(s.songs.map(song => song.id))]))
  // A holder carries every one of a tag's songs, so it is among the tags on
  // its first song: those alone are looked at, not every tag for every tag.
  const onSong = new Map<number, TagStanding[]>()
  for (const standing of standings) {
    for (const song of standing.songs) {
      const list = onSong.get(song.id)
      if (list) list.push(standing)
      else onSong.set(song.id, [standing])
    }
  }
  const holderOf = new Map<number, number>()
  for (const small of standings) {
    const first = small.songs[0]
    if (!first) continue
    let holder: TagStanding | null = null
    for (const big of onSong.get(first.id) ?? []) {
      if (big.songs.length <= small.songs.length) continue
      if (holder && big.songs.length <= holder.songs.length) continue
      const bigSet = sets.get(big.tag.id)
      if (bigSet && small.songs.every(song => bigSet.has(song.id))) holder = big
    }
    if (holder) holderOf.set(small.tag.id, holder.tag.id)
  }
  const inside = new Map<number, TagStanding[]>()
  for (const standing of standings) {
    const holder = holderOf.get(standing.tag.id)
    if (holder === undefined) continue
    const list = inside.get(holder)
    if (list) list.push(standing)
    else inside.set(holder, [standing])
  }
  const main: TagEntry[] = []
  const justStarted: TagEntry[] = []
  const empty: TagEntry[] = []
  for (const standing of standings) {
    if (holderOf.has(standing.tag.id)) continue
    const entry = { standing, inside: inside.get(standing.tag.id) ?? [] }
    if (standing.songs.length === 0) empty.push(entry)
    else if (standing.songs.length <= JUST_STARTED_MAX) justStarted.push(entry)
    else main.push(entry)
  }
  return { main, justStarted, empty }
}

/** What a page of tiles draws one of: a tag's tile, or a chip under its holder's. */
export function tagsLayoutSize(layout: ReturnType<typeof tagsLayout>): number {
  let size = 0
  for (const run of [layout.main, layout.justStarted, layout.empty]) {
    for (const entry of run) size += 1 + entry.inside.length
  }
  return size
}

/**
 * The first `drawn` of the page's tiles and chips, in the page's order: what
 * the page draws until its scroll comes near the end (`useDrawnAhead`). A
 * chip counts as a tile does — five hundred one-song tags inside a handful of
 * holders were every one drawn at once under those few tiles (bug bash m50).
 */
export function firstDrawn(
  layout: ReturnType<typeof tagsLayout>,
  drawn: number,
): ReturnType<typeof tagsLayout> {
  let left = drawn
  const take = (run: readonly TagEntry[]): TagEntry[] => {
    const taken: TagEntry[] = []
    for (const entry of run) {
      if (left <= 0) break
      left -= 1
      const inside = entry.inside.length <= left ? entry.inside : entry.inside.slice(0, left)
      left -= inside.length
      taken.push(inside === entry.inside ? entry : { ...entry, inside })
    }
    return taken
  }
  return {
    main: take(layout.main),
    justStarted: take(layout.justStarted),
    empty: take(layout.empty),
  }
}

/**
 * The song whose cover is a tag's sleeve: the one played most, then the one
 * played last, then the newest. A song with a cover beats one without, so a
 * sleeve is a picture whenever the tag has one to give.
 */
export function leadSong<
  S extends Pick<Song, 'id' | 'hasArt' | 'playCount' | 'lastPlayedAt' | 'addedAt'>,
>(songs: readonly S[]): S | null {
  let best: S | null = null
  for (const song of songs) {
    if (!best || leads(song, best)) best = song
  }
  return best
}

function leads(
  a: Pick<Song, 'id' | 'hasArt' | 'playCount' | 'lastPlayedAt' | 'addedAt'>,
  b: Pick<Song, 'id' | 'hasArt' | 'playCount' | 'lastPlayedAt' | 'addedAt'>,
): boolean {
  if (a.hasArt !== b.hasArt) return a.hasArt
  if (a.playCount !== b.playCount) return a.playCount > b.playCount
  const played = (a.lastPlayedAt ?? '').localeCompare(b.lastPlayedAt ?? '')
  if (played !== 0) return played > 0
  const added = a.addedAt.localeCompare(b.addedAt)
  if (added !== 0) return added > 0
  return a.id > b.id
}

/** One artist the untagged songs are by, for the card at the top (K2). */
export interface WaitingArtist {
  /** The spelling most of the waiting songs use. */
  readonly name: string
  readonly count: number
  /** The newest waiting song of theirs, for the card's covers. */
  readonly song: Song
}

/**
 * Who the songs with no tag yet are by (K2, 2026-10-02): the artists with the
 * most of them, and how many songs are by none of those. "73 by 周杰倫 · 10 by
 * 薛之谦 · 4 by HOYO-MiX · and 24 more" says what is waiting better than a
 * count, and names the artist whose page can tag a batch at once. A song by
 * two artists counts for both, and once however many times its artist field
 * repeats a name.
 */
export function waitingArtists(
  songs: readonly Song[],
  shown: number,
  names: ArtistJoinNames = NO_JOINS,
): { readonly artists: readonly WaitingArtist[]; readonly rest: number } {
  const waiting = untaggedSongs(songs)
  // An artist under two spellings joined by their other names counts as one.
  const shownAs = joinedNames(songs, names)
  const shownName = (name: string): string => shownAs.get(artistKey(name)) ?? name
  const byKey = new Map<string, { count: number; song: Song; spellings: Map<string, number> }>()
  for (const song of waiting) {
    const seen = new Set<string>()
    for (const written of splitArtists(song.artist)) {
      const name = shownName(written)
      const key = artistKey(name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const entry = byKey.get(key)
      if (entry) {
        entry.count += 1
        entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1)
      } else {
        // `untaggedSongs` is newest first, so the first song met is the newest.
        byKey.set(key, { count: 1, song, spellings: new Map([[name, 1]]) })
      }
    }
  }
  const ranked = [...byKey.entries()]
    .map(([key, entry]) => ({ key, ...entry, name: mostUsed(entry.spellings) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, shown)
  const keys = new Set(ranked.map(entry => entry.key))
  const rest = waiting.filter(
    song => !splitArtists(song.artist).some(name => keys.has(artistKey(shownName(name)))),
  ).length
  return {
    artists: ranked.map(({ name, count, song }) => ({ name, count, song })),
    rest,
  }
}

function mostUsed(spellings: ReadonlyMap<string, number>): string {
  let name = ''
  let best = 0
  for (const [spelling, count] of spellings) {
    if (count > best) {
      name = spelling
      best = count
    }
  }
  return name
}

/** The untagged card's line with nobody to name. */
export const UNTAGGED_HINT = 'Suggest tags, or tag them one at a time while they play'

/**
 * The untagged card's line, in a word, who the songs are by: "Mostly
 * Yorushika" when one artist has half of them or more; else the two with the
 * most, "Yorushika, ZUTOMAYO and others". Null with nobody to name. The
 * counts per artist were a list ("58 by Yorushika · 3 by ヨルシカ · 1 by
 * ZUTOMAYO") that a phone cut off mid-name (I1, 2026-10-25).
 */
export function waitingLine(artists: readonly WaitingArtist[], count: number): string | null {
  const [first, second] = artists
  if (!first) return null
  if (first.count * 2 >= count || !second) return `Mostly ${first.name}`
  return `${first.name}, ${second.name}${artists.length > 2 || first.count + second.count < count ? ' and others' : ''}`
}
