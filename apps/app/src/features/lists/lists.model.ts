import { placeSongs, type Place } from '../tag/tag.model'
import {
  DescribeResultSchema,
  fromSqliteTime,
  artistKey,
  libraryArtists,
  type Playlist,
  type QueueState,
  type DescribeResult,
  type Song,
  type Tag,
} from '@selfmp3/shared'

/**
 * Tag, Playlist, Up next (docs/features/lists.md): where what is playing came
 * from, what Up next calls it, what Save would make of it, and what Recently
 * played remembers.
 *
 * Three words, one job each. A tag is a word on songs; a playlist is a list you
 * saved; Up next is what you are listening to now. Everything else — tags
 * combined, an answer to a question, songs found by a search — is not a thing
 * you have to keep before you can hear it: it is played, Up next wears its
 * name, and Save turns it into a playlist once you know you want it again.
 */

/** Songs played as a list that is neither a tag, an artist nor a playlist. */
const SONGS_ORIGINS = ['search', 'similar', 'selection', 'gems', 'untagged', 'found'] as const
type SongsOrigin = (typeof SONGS_ORIGINS)[number]

export type ListSource =
  | { readonly kind: 'library' }
  | { readonly kind: 'tag'; readonly tagId: number; readonly name: string }
  | { readonly kind: 'artist'; readonly key: string; readonly name: string }
  | {
      readonly kind: 'playlist'
      readonly playlistId: number
      readonly name: string
      /** Made from Up next by Save just now: the button says so instead of vanishing. */
      readonly saved?: boolean
    }
  | {
      /** Tags and artists together: any song any of them holds. */
      readonly kind: 'combined'
      readonly tagIds: readonly number[]
      readonly artistKeys: readonly string[]
      /** The names as they were, for when one has since gone. */
      readonly name: string
    }
  | {
      readonly kind: 'answer'
      /** The words asked, which are its name in Up next. */
      readonly text: string
      /** What a playlist made from it is called: the model's name for it. */
      readonly name: string
      /** Its page while the app is open (`/answer?id=…`); not kept across launches. */
      readonly answerId?: string
    }
  | { readonly kind: 'songs'; readonly origin: SongsOrigin; readonly name: string }

/** What a source's line links to, as plain data the screen hands the router. */
interface SourceLink {
  readonly pathname: string
  readonly params?: Readonly<Record<string, string>>
}

/** What the line over Up next's songs shows. */
export interface SourceLine {
  readonly label: string
  /** An answer to Ask: the line wears the sparkle. */
  readonly asked: boolean
  readonly link: SourceLink | null
  /** Saved from Up next a moment ago. */
  readonly saved: boolean
}

/** What Save would make: a playlist filled from tags, or one of these songs. */
export type SavePlan =
  | { readonly kind: 'follow'; readonly name: string; readonly tagIds: readonly number[] }
  | { readonly kind: 'songs'; readonly name: string; readonly songIds: readonly number[] }

interface Known {
  readonly tags: readonly Pick<Tag, 'id' | 'name'>[]
  readonly playlists: readonly Pick<Playlist, 'id' | 'name'>[]
}

/** The tags with these ids, in the order of the ids; ids no tag has are left out. */
export function tagsWithIds<T extends { readonly id: number }>(
  ids: readonly number[],
  tags: readonly T[],
): T[] {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  return ids.flatMap(id => {
    const tag = byId.get(id)
    return tag ? [tag] : []
  })
}

/** Names joined as a combination reads: "原神纯音乐 or YOASOBI". */
export function combinedName(names: readonly string[]): string {
  return names.join(' or ')
}

/** A combination's parts as places, read against the library now; ones that have gone are left out. */
export function combinedPlaces(
  source: { readonly tagIds: readonly number[]; readonly artistKeys: readonly string[] },
  tags: readonly Tag[],
  songs: readonly Song[],
): Place[] {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  const artists = new Map(libraryArtists(songs).map(artist => [artist.key, artist]))
  return [
    ...source.tagIds.flatMap(id => {
      const tag = byId.get(id)
      return tag ? [{ kind: 'tag' as const, tag }] : []
    }),
    ...source.artistKeys.flatMap(key => {
      const artist = artists.get(key)
      return artist ? [{ kind: 'artist' as const, artist }] : []
    }),
  ]
}

/** The source for a set of places: one tag or artist is itself, more are a combination. */
export function placesSource(places: readonly Place[]): ListSource | null {
  const [only] = places
  if (!only) return null
  if (places.length === 1) {
    return only.kind === 'tag'
      ? { kind: 'tag', tagId: only.tag.id, name: only.tag.name }
      : { kind: 'artist', key: only.artist.key, name: only.artist.name }
  }
  return {
    kind: 'combined',
    tagIds: places.flatMap(place => (place.kind === 'tag' ? [place.tag.id] : [])),
    artistKeys: places.flatMap(place => (place.kind === 'artist' ? [place.artist.key] : [])),
    name: combinedName(
      places.map(place => (place.kind === 'tag' ? place.tag.name : place.artist.name)),
    ),
  }
}

/**
 * What Library is playing: all of it, or the tags ticked in its strip — one
 * tag is that tag, more are a combination.
 */
export function librarySource(
  tagIds: readonly number[],
  tags: readonly Pick<Tag, 'id' | 'name'>[],
): ListSource {
  const chosen = tagsWithIds(tagIds, tags)
  const [only] = chosen
  if (!only) return { kind: 'library' }
  if (chosen.length === 1) return { kind: 'tag', tagId: only.id, name: only.name }
  return {
    kind: 'combined',
    tagIds: chosen.map(tag => tag.id),
    artistKeys: [],
    name: combinedName(chosen.map(tag => tag.name)),
  }
}

/** Where a combination opens: its tags and artists in the address. */
export function combinedLink(source: {
  readonly tagIds: readonly number[]
  readonly artistKeys: readonly string[]
}): SourceLink {
  const params: Record<string, string> = {}
  if (source.tagIds.length > 0) params['tags'] = source.tagIds.join(',')
  if (source.artistKeys.length > 0) params['artists'] = source.artistKeys.join(',')
  return { pathname: '/combined', params }
}

/** A combination's address read back; ids that are not numbers are dropped. */
export function parseCombinedParams(params: {
  tags?: string | string[]
  artists?: string | string[]
}): { tagIds: number[]; artistKeys: string[] } {
  const one = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? value.join(',') : (value ?? '')
  const tagIds = one(params.tags)
    .split(',')
    .map(part => Number(part))
    .filter(id => Number.isInteger(id) && id > 0)
  const artistKeys = one(params.artists)
    .split(',')
    .map(part => artistKey(part))
    .filter(key => key.length > 0)
  return { tagIds: [...new Set(tagIds)], artistKeys: [...new Set(artistKeys)] }
}

/**
 * The line over Up next's songs: what it came from, by the name it has now. A
 * tag or playlist renamed shows its new name; one deleted while it plays says
 * so, and Save comes back for it (`savePlan`).
 */
export function describeSource(source: ListSource, known: Known): SourceLine {
  const plain = (label: string, link: SourceLink | null): SourceLine => ({
    label,
    asked: false,
    link,
    saved: false,
  })
  switch (source.kind) {
    case 'library':
      return plain('Library', { pathname: '/library' })
    case 'tag': {
      const tag = known.tags.find(each => each.id === source.tagId)
      return tag
        ? plain(tag.name, { pathname: '/tag/[name]', params: { name: tag.name } })
        : plain(`${source.name} (deleted)`, null)
    }
    case 'artist':
      return plain(source.name, { pathname: '/artist/[name]', params: { name: source.name } })
    case 'playlist': {
      const playlist = known.playlists.find(each => each.id === source.playlistId)
      if (!playlist) return plain(`${source.name} (deleted)`, null)
      return {
        ...plain(playlist.name, {
          pathname: '/playlists/[id]',
          params: { id: String(playlist.id) },
        }),
        saved: source.saved === true,
      }
    }
    case 'combined': {
      const names = tagsWithIds(source.tagIds, known.tags).map(tag => tag.name)
      const whole = names.length === source.tagIds.length
      // An artist's name is not something that changes under it; a tag's is.
      return plain(
        whole && source.artistKeys.length === 0 ? combinedName(names) : source.name,
        combinedLink(source),
      )
    }
    case 'answer':
      return {
        label: source.text,
        asked: true,
        link: source.answerId ? { pathname: '/answer', params: { id: source.answerId } } : null,
        saved: false,
      }
    case 'songs':
      return plain(source.name, null)
  }
}

/**
 * Up next's songs in the order Save keeps: the list's own order, not the
 * shuffle it is being heard in, with anything added to it after, each once.
 */
export function songsToSave(queue: Pick<QueueState, 'items' | 'original'>): number[] {
  const inQueue = new Set(queue.items)
  const seen = new Set<number>()
  const ordered: number[] = []
  for (const id of [...queue.original.filter(id => inQueue.has(id)), ...queue.items]) {
    if (seen.has(id)) continue
    seen.add(id)
    ordered.push(id)
  }
  return ordered
}

/**
 * What Save would make of what is playing, or null when there is nothing to
 * save: a tag, an artist, a playlist and the whole library are already places
 * of their own.
 *
 * Tags combined make a playlist that fills from them, so new songs join it.
 * Anything else makes a playlist of the songs in Up next as they are now: a
 * song swiped out of an answer stays out. Up next edited while a tag or a
 * playlist plays changes nothing lasting (docs/features/lists.md, G1).
 */
export function savePlan(
  source: ListSource,
  queue: Pick<QueueState, 'items' | 'original'>,
  known: Known,
): SavePlan | null {
  const songs = (name: string): SavePlan | null => {
    const songIds = songsToSave(queue)
    return songIds.length >= 2 ? { kind: 'songs', name, songIds } : null
  }
  switch (source.kind) {
    case 'library':
    case 'artist':
      return null
    case 'tag':
      return known.tags.some(tag => tag.id === source.tagId) ? null : songs(source.name)
    case 'playlist':
      return known.playlists.some(playlist => playlist.id === source.playlistId)
        ? null
        : songs(source.name)
    case 'combined': {
      const tags = tagsWithIds(source.tagIds, known.tags)
      if (
        source.artistKeys.length === 0 &&
        tags.length > 0 &&
        tags.length === source.tagIds.length
      ) {
        return {
          kind: 'follow',
          name: combinedName(tags.map(tag => tag.name)),
          tagIds: source.tagIds,
        }
      }
      return songs(source.name)
    }
    case 'answer':
      return songs(source.name)
    case 'songs':
      return source.origin === 'untagged' ? null : songs(source.name)
  }
}

/** A source read back from storage, or null for anything that is not one. */
export function parseListSource(value: unknown): ListSource | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof v[key] === 'string' ? (v[key] as string) : null
  const id = (key: string): number | null =>
    typeof v[key] === 'number' && Number.isInteger(v[key]) ? (v[key] as number) : null
  switch (v['kind']) {
    case 'library':
      return { kind: 'library' }
    case 'tag': {
      const tagId = id('tagId')
      const name = text('name')
      return tagId !== null && name !== null ? { kind: 'tag', tagId, name } : null
    }
    case 'artist': {
      const key = text('key')
      const name = text('name')
      return key !== null && name !== null ? { kind: 'artist', key, name } : null
    }
    case 'playlist': {
      const playlistId = id('playlistId')
      const name = text('name')
      return playlistId !== null && name !== null ? { kind: 'playlist', playlistId, name } : null
    }
    case 'combined': {
      const name = text('name')
      const tagIds = Array.isArray(v['tagIds'])
        ? (v['tagIds'] as unknown[]).filter(Number.isInteger)
        : null
      const artistKeys = Array.isArray(v['artistKeys'])
        ? (v['artistKeys'] as unknown[]).filter((key): key is string => typeof key === 'string')
        : null
      return name !== null && tagIds && artistKeys
        ? { kind: 'combined', tagIds: tagIds as number[], artistKeys, name }
        : null
    }
    case 'answer': {
      const asked = text('text')
      const name = text('name')
      return asked !== null && name !== null ? { kind: 'answer', text: asked, name } : null
    }
    case 'songs': {
      const name = text('name')
      const origin = text('origin')
      const known = SONGS_ORIGINS.find(each => each === origin)
      return name !== null && known !== undefined ? { kind: 'songs', origin: known, name } : null
    }
    default:
      return null
  }
}

// --- Recently played -------------------------------------------------------

/** How many lists Recently played remembers, and how many tiles Home shows. */
const RECENT_LISTS = 12

/** A list played on this device, as Recently played keeps it. */
export interface RecentList {
  readonly key: string
  readonly source: ListSource
  /** The songs as they were played, for a list that has no other home. */
  readonly songIds: readonly number[]
  /** Songs heard from it, so Recently played does not show them twice. */
  readonly played: readonly number[]
  /** When it last started or a song of it last played, in ms. */
  readonly at: number
  /**
   * An Ask answer's own answer, kept so its page can be opened again after the
   * app's memory of it is gone (a reload): Recently played opens the list, it
   * does not play it.
   */
  readonly answer?: DescribeResult
}

/**
 * Which list this is, for remembering it once; null for what Recently played
 * does not keep as a list (the whole library, songs that need a tag).
 */
export function sourceKey(source: ListSource, songIds: readonly number[]): string | null {
  switch (source.kind) {
    case 'library':
      return null
    case 'tag':
      return `tag:${source.tagId}`
    case 'artist':
      return `artist:${source.key}`
    case 'playlist':
      return `playlist:${source.playlistId}`
    case 'combined':
      return `combined:${[...source.tagIds].sort((a, b) => a - b).join(',')}|${[...source.artistKeys].sort().join(',')}`
    case 'answer':
      return `answer:${source.text.trim().toLowerCase()}`
    case 'songs':
      // One song is shown as that song; Recently played already has it.
      if (source.origin === 'untagged' || songIds.length < 2) return null
      return `songs:${source.origin}:${songIds.join(',')}`
  }
}

/** Remember that a list started playing: at the front, once. */
export function withListStarted(
  lists: readonly RecentList[],
  source: ListSource,
  songIds: readonly number[],
  now: number,
  answer?: DescribeResult,
): readonly RecentList[] {
  const key = sourceKey(source, songIds)
  if (key === null) return lists
  const before = lists.find(entry => entry.key === key)
  const kept = answer ?? before?.answer
  const entry: RecentList = {
    key,
    source,
    songIds: songIds.slice(0, 2000),
    played: before?.played ?? [],
    at: now,
    ...(kept ? { answer: kept } : {}),
  }
  return [entry, ...lists.filter(each => each.key !== key)].slice(0, RECENT_LISTS)
}

/** A song of the list playing now was heard: it belongs to the list's tile, not one of its own. */
export function withSongPlayed(
  lists: readonly RecentList[],
  key: string,
  songId: number,
  now: number,
): readonly RecentList[] {
  const index = lists.findIndex(entry => entry.key === key)
  const entry = lists[index]
  if (!entry) return lists
  if (entry.played.includes(songId) && entry.at >= now - 60_000) return lists
  const played = entry.played.includes(songId)
    ? entry.played
    : [...entry.played, songId].slice(-500)
  const next = { ...entry, played, at: now }
  return [next, ...lists.filter((_, at) => at !== index)]
}

/** A remembered list became another — an answer saved as a playlist — keeping its place and plays. */
export function withListRenamed(
  lists: readonly RecentList[],
  from: string,
  to: string,
  source: ListSource,
): readonly RecentList[] {
  const entry = lists.find(each => each.key === from)
  if (!entry) return lists
  return lists.flatMap(each =>
    each.key === from ? [{ ...entry, key: to, source }] : each.key === to ? [] : [each],
  )
}

export function parseRecentLists(raw: string | null): readonly RecentList[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item: unknown): RecentList[] => {
      if (typeof item !== 'object' || item === null) return []
      const v = item as Record<string, unknown>
      const source = parseListSource(v['source'])
      const ids = (key: string): number[] =>
        Array.isArray(v[key])
          ? (v[key] as unknown[]).filter((id): id is number => Number.isInteger(id))
          : []
      const key = v['key']
      const at = v['at']
      if (!source || typeof key !== 'string' || typeof at !== 'number') return []
      const answer = DescribeResultSchema.safeParse(v['answer'])
      return [
        {
          key,
          source,
          songIds: ids('songIds'),
          played: ids('played'),
          at,
          ...(answer.success ? { answer: answer.data } : {}),
        },
      ]
    })
  } catch {
    return []
  }
}

/** A song's `lastPlayedAt` (the server's UTC `YYYY-MM-DD HH:MM:SS`) in ms, or null. */
function playedAtMs(lastPlayedAt: string | null): number | null {
  if (!lastPlayedAt) return null
  const ms = fromSqliteTime(lastPlayedAt)
  return Number.isNaN(ms) ? null : ms
}

/** A tile of Home's Recently played: a list you played, or a song played on its own. */
export type HomeRecent =
  | { readonly kind: 'list'; readonly entry: RecentList; readonly at: number }
  | { readonly kind: 'song'; readonly song: Song; readonly at: number }

/**
 * Recently played: what you listened to, newest first — a list when you played
 * a list, a song when you played a song. A song heard as part of a list shows
 * as that list's tile, not as a tile of its own. Lists whose songs have all
 * gone from the library are left out.
 */
export function homeRecents(
  lists: readonly RecentList[],
  songs: readonly Song[],
  limit: number = RECENT_LISTS,
): HomeRecent[] {
  const known = new Set(songs.map(song => song.id))
  const live = lists.filter(entry => entry.songIds.some(id => known.has(id)))
  // A song is covered by a list it was heard in, as long as that list was
  // playing around when the song last played (a few minutes' slack for a play
  // that reached the server late).
  const coveredUntil = new Map<number, number>()
  for (const entry of live) {
    for (const id of entry.played) {
      coveredUntil.set(id, Math.max(coveredUntil.get(id) ?? 0, entry.at))
    }
  }
  const songTiles: HomeRecent[] = []
  for (const song of songs) {
    const at = playedAtMs(song.lastPlayedAt)
    if (at === null) continue
    const covered = coveredUntil.get(song.id)
    if (covered !== undefined && covered >= at - 10 * 60_000) continue
    songTiles.push({ kind: 'song', song, at })
  }
  return [...live.map(entry => ({ kind: 'list' as const, entry, at: entry.at })), ...songTiles]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

/** The quiet line under a list's tile: what kind of list it is. */
export function recentKind(source: ListSource): string {
  switch (source.kind) {
    case 'library':
      return 'Library'
    case 'tag':
      return 'Tag'
    case 'artist':
      return 'Artist'
    case 'playlist':
      return 'Playlist'
    case 'combined': {
      const count = source.tagIds.length + source.artistKeys.length
      return source.artistKeys.length === 0 ? `${count} tags` : `${count} together`
    }
    case 'answer':
      return 'You asked'
    case 'songs':
      switch (source.origin) {
        case 'similar':
          return 'Similar songs'
        case 'selection':
          return 'Songs you picked'
        case 'gems':
          return 'Forgotten gems'
        case 'search':
        case 'found':
          return 'From Search'
        case 'untagged':
          return 'Need a tag'
      }
  }
}

/**
 * The songs a remembered list plays again. A tag, an artist or tags combined
 * are read again from the library, so a song tagged since is in it; anything
 * else plays as it was, less what has left the library.
 */
export function recentSongIds(
  entry: RecentList,
  library: { readonly songs: readonly Song[]; readonly tags: readonly Tag[] },
): number[] {
  const known = new Set(library.songs.map(song => song.id))
  const kept = entry.songIds.filter(id => known.has(id))
  const source = entry.source
  if (source.kind === 'tag' || source.kind === 'artist' || source.kind === 'combined') {
    const places =
      source.kind === 'combined'
        ? combinedPlaces(source, library.tags, library.songs)
        : source.kind === 'tag'
          ? combinedPlaces({ tagIds: [source.tagId], artistKeys: [] }, library.tags, library.songs)
          : combinedPlaces({ tagIds: [], artistKeys: [source.key] }, library.tags, library.songs)
    if (places.length > 0) return placeSongs(places, library.songs).map(song => song.id)
  }
  return kept
}
