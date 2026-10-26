import { plural, fuzzyRank, type Library, type Artist } from '@selfmp3/shared'
import { isUntagged } from '../tag/tag.model'
import { recentItems, searchLibrary, type RecentItem } from '../search/search.model'

export type { RecentItem }

/**
 * The command palette's rules, with nothing drawn: which commands there are, what a
 * query finds, and moving through the list. When lyrics are worth searching is
 * Search's rule (`lyricsQueryFor`), which the palette shares.
 */

export type PaletteCommandId =
  | 'nav-library'
  | 'nav-playlists'
  | 'nav-import'
  | 'nav-stats'
  | 'nav-settings'
  | 'tag-untagged'
  | 'shuffle-all'
  | 'rescan-library'

interface PaletteCommand {
  readonly id: PaletteCommandId
  readonly label: string
  readonly hint?: string
}

/**
 * The page each "Go to" command goes to, and whether an address is that page.
 * A playlist's own page is not the Playlists page: going to the list of them
 * from inside one is still somewhere to go.
 */
const COMMAND_PAGE: Partial<Record<PaletteCommandId, (pathname: string) => boolean>> = {
  'nav-library': pathname => pathname === '/library',
  'nav-playlists': pathname => pathname === '/playlists',
  'nav-import': pathname => pathname === '/import',
  'nav-stats': pathname => pathname === '/stats' || pathname.startsWith('/stats/'),
  'nav-settings': pathname => pathname === '/settings',
}

/**
 * `fromCloud`: only for the things a cloud library genuinely cannot do — there
 * is no library folder to rescan. Stats is offered: its page reaches for the
 * server and says so when there is none.
 * `untaggedCount`: tagging the songs without a tag plays them, so with none
 * there is nothing to offer.
 * `pathname`: the page the palette was opened on, whose own "Go to" is left out.
 */
export function paletteCommands(
  songCount: number,
  fromCloud = false,
  untaggedCount = 0,
  pathname: string | null = null,
): readonly PaletteCommand[] {
  const commands: PaletteCommand[] = [
    { id: 'nav-library', label: 'Go to Library' },
    { id: 'nav-playlists', label: 'Go to Playlists' },
    { id: 'nav-import', label: 'Import music' },
    { id: 'nav-stats', label: 'Go to Stats' },
    { id: 'nav-settings', label: 'Settings' },
    ...(untaggedCount > 0
      ? [
          {
            id: 'tag-untagged' as const,
            label: 'Tag untagged songs',
            hint: `${untaggedCount} untagged`,
          },
        ]
      : []),
    { id: 'shuffle-all', label: 'Shuffle everything', hint: plural(songCount, 'song', 'songs') },
    // Not offered on a bucket library: there is no folder to scan.
    ...(fromCloud
      ? []
      : [{ id: 'rescan-library' as const, label: 'Look for new songs in the library folder' }]),
  ]
  if (pathname === null) return commands
  return commands.filter(command => !COMMAND_PAGE[command.id]?.(pathname))
}

type Songs = Library['songs']
type Playlists = Library['playlists']
type Tags = Library['tags']

export interface PaletteResults {
  /** What was typed, trimmed and lowercased (`placesOf`). */
  readonly words: string
  /** Only with nothing typed. */
  readonly recent: readonly RecentItem[]
  readonly commands: readonly PaletteCommand[]
  readonly artists: readonly Artist[]
  readonly songs: Songs
  /** How many songs matched, of which `songs` are the best few. */
  readonly songsFound: number
  readonly playlists: Playlists
  readonly tags: Tags
  /** Tags only some of the words name, which are not a match (`searchLibrary`). */
  readonly named: Tags
}

/**
 * Untagged songs, counted once per library rather than once per letter typed.
 * Keyed weakly on the songs array, which the library query keeps until it
 * refetches.
 */
const untaggedCounts = new WeakMap<Songs, number>()

export function untaggedCount(songs: Songs): number {
  let count = untaggedCounts.get(songs)
  if (count === undefined) {
    count = songs.filter(isUntagged).length
    untaggedCounts.set(songs, count)
  }
  return count
}

/** Where the palette was opened, and what is loaded: what the empty palette leaves out and leads with. */
interface PaletteContext {
  readonly pathname?: string | null
  readonly currentSongId?: number | null
}

/**
 * With no query, what was played lately and then every command but the one for
 * this page; with one, the best few of each kind, commands included.
 */
export function paletteResults(
  query: string,
  library: Pick<Library, 'songs' | 'playlists' | 'tags' | 'artistNames' | 'spellings'> | undefined,
  fromCloud = false,
  context: PaletteContext = {},
): PaletteResults {
  const songs = library?.songs ?? []
  const trimmed = query.trim()
  if (!trimmed) {
    return {
      words: '',
      recent: recentItems(library, context.currentSongId ?? null),
      commands: paletteCommands(songs.length, fromCloud, untaggedCount(songs), context.pathname),
      artists: [],
      songs: [],
      songsFound: 0,
      playlists: [],
      tags: [],
      named: [],
    }
  }
  // Typed, every command is findable: "library" on the Library still finds it.
  const commands = paletteCommands(songs.length, fromCloud, untaggedCount(songs))
  const top = <T>(items: readonly T[], text: (item: T) => string, count: number): T[] =>
    fuzzyRank(trimmed, items, text)
      .slice(0, count)
      .map(match => match.item)
  const found = searchLibrary(trimmed, library)
  return {
    words: found.words,
    recent: [],
    commands: top(commands, command => command.label, 5),
    // Search's own answer (search.model.ts), cut to a palette's few of each:
    // artists and tags, songs, and the palette's extra, playlists.
    artists: found.artists.slice(0, 3),
    songs: found.songs.slice(0, 8),
    songsFound: found.songs.length,
    playlists: top(library?.playlists ?? [], playlist => playlist.name, 4),
    tags: found.tags.slice(0, 4),
    named: found.named.slice(0, 4),
  }
}

/** How many lines of lyrics the palette shows, of the ones Search asks for. */
export const PALETTE_LYRICS = 6

/**
 * How many rows a find draws that match what was typed, its lines of lyrics
 * with them: what tells Enter whether anything matched, so whether it asks
 * (`useLibrarySearch`). Tags only some of the words name are drawn but are not
 * a match (D1).
 */
export function paletteMatches(found: PaletteResults, lyricHits: number): number {
  return (
    found.recent.length +
    found.artists.length +
    found.tags.length +
    found.songs.length +
    Math.min(lyricHits, PALETTE_LYRICS) +
    found.playlists.length +
    found.commands.length
  )
}

/** The highlight after an arrow key, wrapping at both ends. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((current + delta) % count) + count) % count
}
