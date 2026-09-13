import { fuzzyRank, isCjkQuery, type Library } from '@selfmp3/shared'

/**
 * The ⌘K palette's rules, with nothing drawn: which commands there are, what a
 * query finds, when lyrics are worth searching, and moving through the list.
 * The web's `CommandPalette`, less the destinations this app does not have yet.
 */

export type PaletteCommandId =
  'nav-library' | 'nav-playlists' | 'nav-import' | 'nav-settings' | 'shuffle-all'

export interface PaletteCommand {
  readonly id: PaletteCommandId
  readonly label: string
  readonly hint?: string
}

/** `fromCloud`: a cloud library has no Mac to import with, so no Import. */
export function paletteCommands(songCount: number, fromCloud = false): readonly PaletteCommand[] {
  return [
    { id: 'nav-library', label: 'Go to Library' },
    { id: 'nav-playlists', label: 'Go to Playlists' },
    ...(fromCloud ? [] : [{ id: 'nav-import' as const, label: 'Import music' }]),
    { id: 'nav-settings', label: 'Settings' },
    { id: 'shuffle-all', label: 'Shuffle everything', hint: `${songCount} songs` },
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

/** Every command with no query; with one, the best few of each kind. */
export function paletteResults(
  query: string,
  library: Pick<Library, 'songs' | 'playlists' | 'tags'> | undefined,
  fromCloud = false,
): PaletteResults {
  const songs = library?.songs ?? []
  const commands = paletteCommands(songs.length, fromCloud)
  const trimmed = query.trim()
  if (!trimmed) return { commands, songs: [], playlists: [], tags: [] }
  const top = <T>(items: readonly T[], text: (item: T) => string, count: number): T[] =>
    fuzzyRank(trimmed, items, text)
      .slice(0, count)
      .map(match => match.item)
  return {
    commands: top(commands, command => command.label, 5),
    songs: top(songs, song => `${song.title} ${song.artist} ${song.album}`, 8),
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
