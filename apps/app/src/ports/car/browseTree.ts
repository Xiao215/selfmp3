import { libraryArtists, plural, type Playlist, type Song } from '@selfmp3/shared'
import { listedPlaylists } from '../../features/playlists/playlists.model'
import { albumsOf } from '../../features/tag/tag.model'

/**
 * The library as a browsable hierarchy, for the car.
 *
 * A head unit wants a shallow tree of lists where every leaf starts playback.
 * Building it as pure data — rather than inside whatever native template code
 * ends up publishing it — means it can be unit tested, and means the identical
 * tree is ready to hand to Android Auto if and when react-native-track-player
 * exposes an API for it (see docs/MOBILE.md). Nothing browses it today; what
 * it is used for now is voice and media-id playback (`androidAuto.ts`).
 *
 * Every id is a plain string so it can survive a round trip through a native
 * media-id field. The lists come in the app's own orders, from the app's own
 * models: playlists as the Playlists page lists them, artists as the library
 * names them (a collaboration under each artist in it), an album's songs and
 * an artist's albums as an artist page shows them.
 */

export const ROOT_ID = 'root'

/** Separator between a node id and a song id in a playable item's id. */
const LEAF_SEPARATOR = '|'

interface BrowseItem {
  /** Unique, and parseable back into a node (and song, for playable items). */
  readonly id: string
  readonly title: string
  readonly subtitle: string
  /** True for a list you can open, false for a song you can play. */
  readonly browsable: boolean
  /** Song whose cover art represents this row, when there is one. */
  readonly artSongId: number | null
}

interface BrowseNode {
  readonly id: string
  readonly title: string
  readonly items: readonly BrowseItem[]
  /**
   * The queue this node represents, in order. Empty for nodes that only
   * contain other nodes.
   */
  readonly songIds: readonly number[]
}

export interface BrowseTree {
  readonly nodes: Readonly<Record<string, BrowseNode>>
}

export interface BrowseInput {
  readonly songs: readonly Song[]
  readonly playlists: readonly Playlist[]
  /** Resolved playlist contents, in playlist order. */
  readonly playlistSongIds: Readonly<Record<number, readonly number[]>>
}

interface BrowseOptions {
  /**
   * Head units cap how many rows a list may have — typically a couple of
   * hundred, and the API to ask for the number is asynchronous. Capping here
   * keeps every list well inside it and, more usefully, keeps a
   * five-thousand-song "Artists" list from being unusable while driving.
   */
  readonly maxItemsPerNode?: number
  /** How many songs "Recently added" shows. */
  readonly recentLimit?: number
}

const DEFAULT_MAX_ITEMS = 200
const DEFAULT_RECENT_LIMIT = 100

/** `album.Abbey%20Road` — encoded so a name with a separator in it is safe. */
function nodeId(kind: string, key: string): string {
  return `${kind}.${encodeURIComponent(key)}`
}

function leafId(parentNodeId: string, songId: number): string {
  return `${parentNodeId}${LEAF_SEPARATOR}${songId}`
}

function songItem(parentNodeId: string, song: Song): BrowseItem {
  return {
    id: leafId(parentNodeId, song.id),
    title: song.title,
    subtitle: song.artist,
    browsable: false,
    artSongId: song.hasArt ? song.id : null,
  }
}

function songNode(id: string, title: string, songs: readonly Song[], limit: number): BrowseNode {
  const capped = songs.slice(0, limit)
  return {
    id,
    title,
    items: capped.map(song => songItem(id, song)),
    songIds: capped.map(song => song.id),
  }
}

export function buildBrowseTree(input: BrowseInput, options: BrowseOptions = {}): BrowseTree {
  const limit = options.maxItemsPerNode ?? DEFAULT_MAX_ITEMS
  const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT

  const songs = input.songs
  const byId = new Map(songs.map(song => [song.id, song]))

  const nodes: Record<string, BrowseNode> = {}

  // --- playlists ----------------------------------------------------------

  const playlistItems: BrowseItem[] = []
  // As the Playlists page lists them, less the empty ones: a car has nothing
  // to do with one but play it, and it would play nothing.
  const playable = listedPlaylists(input.playlists, 'recent').filter(
    playlist => playlist.songCount > 0,
  )
  for (const playlist of playable.slice(0, limit)) {
    const id = nodeId('playlist', String(playlist.id))
    const contents = (input.playlistSongIds[playlist.id] ?? [])
      .map(songId => byId.get(songId))
      .filter((song): song is Song => song !== undefined)

    nodes[id] = songNode(id, playlist.name, contents, limit)
    playlistItems.push({
      id,
      title: playlist.name,
      subtitle: plural(contents.length, 'song', 'songs'),
      browsable: true,
      artSongId: contents.find(song => song.hasArt)?.id ?? null,
    })
  }
  nodes['playlists'] = { id: 'playlists', title: 'Playlists', items: playlistItems, songIds: [] }

  // --- albums -------------------------------------------------------------

  const albumItems: BrowseItem[] = []
  // Songs with no album are no album: they are not shown as a blank row.
  for (const { album, songs: tracks } of albumsOf(songs).filter(group => group.album !== '')) {
    const id = nodeId('album', album)
    nodes[id] = songNode(id, album, tracks, limit)
    albumItems.push({
      id,
      title: album,
      subtitle: tracks[0]?.albumArtist || (tracks[0]?.artist ?? ''),
      browsable: true,
      artSongId: tracks.find(song => song.hasArt)?.id ?? null,
    })
  }
  nodes['albums'] = {
    id: 'albums',
    title: 'Albums',
    items: albumItems.slice(0, limit),
    songIds: [],
  }

  // --- artists ------------------------------------------------------------

  const artistItems: BrowseItem[] = []
  for (const artist of libraryArtists(songs)) {
    const id = nodeId('artist', artist.name)
    const theirs = artist.songIds.flatMap(songId => byId.get(songId) ?? [])
    const sorted = albumsOf(theirs).flatMap(group => group.songs)
    nodes[id] = songNode(id, artist.name, sorted, limit)
    artistItems.push({
      id,
      title: artist.name,
      subtitle: plural(sorted.length, 'song', 'songs'),
      browsable: true,
      artSongId: sorted.find(song => song.hasArt)?.id ?? null,
    })
  }
  nodes['artists'] = {
    id: 'artists',
    title: 'Artists',
    items: artistItems.slice(0, limit),
    songIds: [],
  }

  // --- recently added -----------------------------------------------------

  const recent = [...songs].sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const recentNode = songNode('recent', 'Recently added', recent, recentLimit)
  nodes['recent'] = recentNode

  // --- root ---------------------------------------------------------------

  nodes[ROOT_ID] = {
    id: ROOT_ID,
    title: 'self.mp3',
    songIds: [],
    items: [
      browsableItem('playlists', 'Playlists', `${playlistItems.length}`),
      browsableItem('albums', 'Albums', `${albumItems.length}`),
      browsableItem('artists', 'Artists', `${artistItems.length}`),
      browsableItem('recent', 'Recently added', `${recentNode.songIds.length}`),
    ],
  }

  return { nodes }
}

function browsableItem(id: string, title: string, subtitle: string): BrowseItem {
  return { id, title, subtitle, browsable: true, artSongId: null }
}

export function nodeById(tree: BrowseTree, id: string): BrowseNode | null {
  return tree.nodes[id] ?? null
}

/**
 * What to do when a media id arrives from the car.
 *
 * A browsable id resolves to the list to show; a playable one resolves to the
 * queue it belongs to and the position to start at, which is what makes
 * picking track 7 of an album play the rest of the album after it.
 */
type BrowseSelection =
  | { readonly kind: 'browse'; readonly node: BrowseNode }
  | { readonly kind: 'play'; readonly songIds: readonly number[]; readonly startIndex: number }

export function resolveMediaId(tree: BrowseTree, mediaId: string): BrowseSelection | null {
  const separator = mediaId.lastIndexOf(LEAF_SEPARATOR)

  if (separator === -1) {
    const node = nodeById(tree, mediaId)
    return node ? { kind: 'browse', node } : null
  }

  const parent = nodeById(tree, mediaId.slice(0, separator))
  const songId = Number(mediaId.slice(separator + 1))
  if (!parent || !Number.isInteger(songId)) return null

  const startIndex = parent.songIds.indexOf(songId)
  if (startIndex === -1) return null

  return { kind: 'play', songIds: parent.songIds, startIndex }
}

/**
 * Best match for a spoken request ("play the album Kind of Blue").
 *
 * Deliberately simple: case-insensitive substring over node titles first —
 * a whole album or playlist is usually what was meant — then song titles.
 */
export function searchBrowseTree(tree: BrowseTree, query: string): BrowseSelection | null {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return null

  const nodes = Object.values(tree.nodes).filter(node => node.songIds.length > 0)

  const nodeMatch =
    nodes.find(node => node.title.toLowerCase() === needle) ??
    nodes.find(node => node.title.toLowerCase().includes(needle))
  if (nodeMatch) return { kind: 'play', songIds: nodeMatch.songIds, startIndex: 0 }

  for (const node of nodes) {
    const index = node.items.findIndex(item => item.title.toLowerCase().includes(needle))
    if (index !== -1) return { kind: 'play', songIds: node.songIds, startIndex: index }
  }

  return null
}
