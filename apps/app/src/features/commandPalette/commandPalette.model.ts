import { fuzzyRank, isCjkQuery, type Library } from '@selfmp3/shared'
import { topSongs } from '@selfmp3/client'

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
  'nav-library': pathname => pathname === '/',
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

/** Something played lately, offered before anything is typed. */
export type RecentItem =
  | { readonly kind: 'song'; readonly song: Songs[number] }
  | { readonly kind: 'playlist'; readonly playlist: Playlists[number] }

/** How many recent things the empty palette offers: a glance, not a history page. */
const RECENT_LIMIT = 5

/**
 * What was played lately, newest first: the song loaded now, then songs and
 * playlists by when they were last played.
 *
 * The loaded song leads because it is the one most likely wanted back — a
 * restored session, paused — and its last play may not have counted yet. The
 * rest come from the library's own `lastPlayedAt`, which the server keeps for
 * every device, so a song finished on the phone is recent here too.
 */
export function recentItems(
  library: Pick<Library, 'songs' | 'playlists'> | undefined,
  currentSongId: number | null = null,
  limit = RECENT_LIMIT,
): readonly RecentItem[] {
  if (!library || limit <= 0) return []
  const current =
    currentSongId === null ? undefined : library.songs.find(song => song.id === currentSongId)
  const dated: { at: string; item: RecentItem }[] = []
  for (const song of library.songs) {
    if (song.lastPlayedAt && song.id !== currentSongId && !song.missing) {
      dated.push({ at: song.lastPlayedAt, item: { kind: 'song', song } })
    }
  }
  for (const playlist of library.playlists) {
    if (playlist.lastPlayedAt)
      dated.push({ at: playlist.lastPlayedAt, item: { kind: 'playlist', playlist } })
  }
  // ISO timestamps sort as text; the newest is the largest.
  dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const items = dated.map(entry => entry.item)
  return (current ? [{ kind: 'song' as const, song: current }, ...items] : items).slice(0, limit)
}

export interface PaletteResults {
  /** Only with nothing typed. */
  readonly recent: readonly RecentItem[]
  readonly commands: readonly PaletteCommand[]
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
  return {
    recent: [],
    commands: top(commands, command => command.label, 5),
    // The library's own search, top eight picked without ranking the other
    // few thousand: this runs on every letter typed.
    songs: topSongs(trimmed, songs, 8),
    playlists: top(library?.playlists ?? [], playlist => playlist.name, 4),
    tags: top(library?.tags ?? [], tag => tag.name, 4),
  }
}

/**
 * The query worth sending to the lyric search, or '' when it is too short to
 * mean anything: two characters is a word in Chinese or Japanese, three is the
 * floor for Latin text.
 */
export function lyricsQueryFor(query: string): string {
  const trimmed = query.trim()
  return trimmed.length >= (isCjkQuery(trimmed) ? 2 : 3) ? trimmed : ''
}

/** The highlight after an arrow key, wrapping at both ends. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((current + delta) % count) + count) % count
}
