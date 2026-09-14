import { fuzzyRank, isCjkQuery, type Library } from '@selfmp3/shared'
import { topSongs } from '@selfmp3/client'

/**
 * The ⌘K palette's rules, with nothing drawn: which commands there are, what a
 * query finds, when lyrics are worth searching, and moving through the list.
 * The web's `CommandPalette`, less the destinations this app does not have yet.
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

export interface PaletteCommand {
  readonly id: PaletteCommandId
  readonly label: string
  readonly hint?: string
}

/** `fromCloud`: a cloud library has no Mac to count plays on or tag from; its imports wait for one. */
export function paletteCommands(
  songCount: number,
  fromCloud = false,
  untaggedCount = 0,
): readonly PaletteCommand[] {
  return [
    { id: 'nav-library', label: 'Go to Library' },
    { id: 'nav-playlists', label: 'Go to Playlists' },
    { id: 'nav-import', label: 'Import music' },
    ...(fromCloud ? [] : [{ id: 'nav-stats' as const, label: 'Listening stats' }]),
    { id: 'nav-settings', label: 'Settings' },
    ...(fromCloud
      ? []
      : [
          {
            id: 'nav-inbox' as const,
            label: 'Tag untagged songs',
            hint: `${untaggedCount} untagged`,
          },
        ]),
    { id: 'shuffle-all', label: 'Shuffle everything', hint: `${songCount} songs` },
    // The sidebar's foot used to hold this; a bucket has no folder to scan.
    ...(fromCloud ? [] : [{ id: 'rescan-library' as const, label: 'Rescan library folder' }]),
  ]
}

type Songs = Library['songs']
type Playlists = Library['playlists']
type Tags = Library['tags']

export interface PaletteResults {
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

/** Every command with no query; with one, the best few of each kind. */
export function paletteResults(
  query: string,
  library: Pick<Library, 'songs' | 'playlists' | 'tags'> | undefined,
  fromCloud = false,
): PaletteResults {
  const songs = library?.songs ?? []
  const commands = paletteCommands(songs.length, fromCloud, untaggedCount(songs))
  const trimmed = query.trim()
  if (!trimmed) return { commands, songs: [], playlists: [], tags: [] }
  const top = <T>(items: readonly T[], text: (item: T) => string, count: number): T[] =>
    fuzzyRank(trimmed, items, text)
      .slice(0, count)
      .map(match => match.item)
  return {
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
