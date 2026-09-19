import { fuzzyRank, type Library } from '@selfmp3/shared'
import type { Artist } from '@selfmp3/client'
import { recentItems, searchLibrary, type RecentItem } from '../search/search.model'

export type { RecentItem }

/**
 * The command palette's rules, with nothing drawn: which commands there are, what a
 * query finds, when lyrics are worth searching, and moving through the list.
 */

export type PaletteCommandId =
  | 'nav-library'
  | 'nav-playlists'
  | 'nav-import'
  | 'nav-stats'
  | 'nav-settings'
  | 'nav-inbox'
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
  'nav-inbox': pathname => pathname === '/inbox',
}

/**
 * `fromCloud`: only for the things a cloud library genuinely cannot do — there
 * is no library folder to rescan. Stats and the tag inbox are offered: the
 * inbox needs no server at all, and the Stats page reaches for one and says so
 * when there is none.
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
    { id: 'nav-inbox', label: 'Tag untagged songs', hint: `${untaggedCount} untagged` },
    { id: 'shuffle-all', label: 'Shuffle everything', hint: `${songCount} songs` },
    // Not offered on a bucket library: there is no folder to scan.
    ...(fromCloud ? [] : [{ id: 'rescan-library' as const, label: 'Rescan library folder' }]),
  ]
  if (pathname === null) return commands
  return commands.filter(command => !COMMAND_PAGE[command.id]?.(pathname))
}

type Songs = Library['songs']
type Playlists = Library['playlists']
type Tags = Library['tags']

export interface PaletteResults {
  /** Only with nothing typed. */
  readonly recent: readonly RecentItem[]
  readonly commands: readonly PaletteCommand[]
  readonly artists: readonly Artist[]
  readonly songs: Songs
  readonly playlists: Playlists
  readonly tags: Tags
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
    count = songs.filter(song => song.tagIds.length === 0 && !song.missing).length
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
  library: Pick<Library, 'songs' | 'playlists' | 'tags'> | undefined,
  fromCloud = false,
  context: PaletteContext = {},
): PaletteResults {
  const songs = library?.songs ?? []
  const trimmed = query.trim()
  if (!trimmed) {
    return {
      recent: recentItems(library, context.currentSongId ?? null),
      commands: paletteCommands(songs.length, fromCloud, untaggedCount(songs), context.pathname),
      artists: [],
      songs: [],
      playlists: [],
      tags: [],
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
    recent: [],
    commands: top(commands, command => command.label, 5),
    // Search's own answer (search.model.ts), cut to a palette's few of each:
    // artists and tags, songs, and the palette's extra, playlists.
    artists: found.artists.slice(0, 3),
    songs: found.songs.slice(0, 8),
    playlists: top(library?.playlists ?? [], playlist => playlist.name, 4),
    tags: found.tags.slice(0, 4),
  }
}

/** The highlight after an arrow key, wrapping at both ends. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((current + delta) % count) + count) % count
}
