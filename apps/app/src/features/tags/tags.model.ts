import { plural, artistKey, splitArtists, type Song } from '@selfmp3/shared'
import { untaggedSongs, type TagStanding } from '../tag/tag.model'

/**
 * All tags, without the screen (docs/ui-mock `P07`).
 *
 * The rows themselves — their order, their line, the untagged card's title —
 * are the tag model's (`features/tag/tag.model.ts`), because Home's tiles and
 * a tag's own page count the same way. What is left here is the page's own
 * words, and how the page lays the tags out.
 */

/** "8 tags · most played first", under the title, or what to say when there are none. */
export function tagsHeadline(count: number): string {
  if (count === 0) return 'No tags yet'
  return `${plural(count, 'tag', 'tags')} · most played first`
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
 * A tag whose every song another, bigger tag also carries is drawn inside that
 * tag rather than beside it: the four regions of a game inside the game's tag.
 * Nothing is set up for this and nothing is stored; it follows the songs, so a
 * region that gains a song from elsewhere steps back out on its own. The
 * holder is the biggest such tag, which can never itself be inside another
 * (anything holding it would be bigger, and would hold the region too), so
 * there is only ever one level. Two tags on exactly the same songs stay side
 * by side: neither is the bigger. An empty tag is inside nothing.
 *
 * What is left is split by size: tags with a song or two wait at the end, so
 * the page opens on the ones in use. `standings` keeps its order in both runs
 * and inside each holder.
 */
export function tagsLayout(standings: readonly TagStanding[]): {
  readonly main: readonly TagEntry[]
  readonly justStarted: readonly TagEntry[]
} {
  const sets = new Map(standings.map(s => [s.tag.id, new Set(s.songs.map(song => song.id))]))
  const holderOf = new Map<number, number>()
  for (const small of standings) {
    if (small.songs.length === 0) continue
    let holder: TagStanding | null = null
    for (const big of standings) {
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
  for (const standing of standings) {
    if (holderOf.has(standing.tag.id)) continue
    const entry = { standing, inside: inside.get(standing.tag.id) ?? [] }
    if (standing.songs.length <= JUST_STARTED_MAX) justStarted.push(entry)
    else main.push(entry)
  }
  return { main, justStarted }
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
): { readonly artists: readonly WaitingArtist[]; readonly rest: number } {
  const waiting = untaggedSongs(songs)
  const byKey = new Map<string, { count: number; song: Song; spellings: Map<string, number> }>()
  for (const song of waiting) {
    const seen = new Set<string>()
    for (const name of splitArtists(song.artist)) {
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
    song => !splitArtists(song.artist).some(name => keys.has(artistKey(name))),
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
