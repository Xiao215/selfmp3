import {
  plural,
  formatLongDuration,
  fuzzyRank,
  type Song,
  type Tag,
  artistKey,
  libraryArtists,
  songArtistKeys,
  type Artist,
} from '@selfmp3/shared'

/**
 * Tags and artists as places (docs/ui-mock `P07`–`P11`, `C06`), without the
 * screens.
 *
 * A tag, an artist and a playlist are the same kind of page. A tag page opens
 * with one tag chosen; Add puts more tags and artists beside it, and every one
 * turned on **adds** its songs — a union, never a narrowing. An artist is the
 * same page with a figure where a tag has its dot.
 */

export type Place =
  { readonly kind: 'tag'; readonly tag: Tag } | { readonly kind: 'artist'; readonly artist: Artist }

/** One key for either kind, so a set of places can be kept and compared. */
export function placeKey(place: Place): string {
  return place.kind === 'tag' ? `tag:${place.tag.id}` : `artist:${place.artist.key}`
}

export function placeName(place: Place): string {
  return place.kind === 'tag' ? place.tag.name : place.artist.name
}

/** How many songs a place holds, by what the place itself knows. */
export function placeSize(place: Place): number {
  return place.kind === 'tag' ? place.tag.songCount : place.artist.songIds.length
}

/**
 * Every song any of the places holds, each once, newest first as Library
 * opens.
 */
export function placeSongs<S extends Song>(places: readonly Place[], songs: readonly S[]): S[] {
  if (places.length === 0) return []
  const tagIds = new Set<number>()
  const artistKeys = new Set<string>()
  for (const place of places) {
    if (place.kind === 'tag') tagIds.add(place.tag.id)
    else artistKeys.add(place.artist.key)
  }
  return songs
    .filter(
      song =>
        song.tagIds.some(id => tagIds.has(id)) ||
        (artistKeys.size > 0 && songArtistKeys(song).some(key => artistKeys.has(key))),
    )
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id)
}

/** "12 songs · 46 min", under a place's name. */
export function placeSummary(songs: readonly Pick<Song, 'duration'>[]): string {
  const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
  const count = `${songs.length.toLocaleString()} ${songs.length === 1 ? 'song' : 'songs'}`
  return songs.length === 0 ? count : `${count} · ${formatLongDuration(seconds)}`
}

/** A song with no tag yet: the untagged card's songs. */
export function isUntagged(song: Pick<Song, 'tagIds'>): boolean {
  return song.tagIds.length === 0
}

/** Newest first: what was just imported is what most needs a tag. */
export function untaggedSongs<T extends Pick<Song, 'id' | 'tagIds' | 'addedAt'>>(
  songs: readonly T[],
): T[] {
  return songs.filter(isUntagged).sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id)
}

/** "2 songs have no tag yet", on the card at the top of All tags. */
export function untaggedCardTitle(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'song has' : 'songs have'} no tag yet`
}

export interface TagStanding {
  readonly tag: Tag
  /** Its songs, as the library has them now. */
  readonly songs: readonly Song[]
  /** Plays of those songs, all told. */
  readonly plays: number
  /** Seconds of music. */
  readonly seconds: number
}

/**
 * Every tag with its songs, most played first — by the plays of the songs it
 * carries — then the biggest, then by name, so the order never shuffles on a
 * tie. All tags lists every one; Home's tiles are the first few with songs.
 */
export function tagsMostPlayed(tags: readonly Tag[], songs: readonly Song[]): TagStanding[] {
  const byTag = new Map<number, Song[]>()
  for (const song of songs) {
    for (const id of song.tagIds) {
      const list = byTag.get(id)
      if (list) list.push(song)
      else byTag.set(id, [song])
    }
  }
  return tags
    .map(tag => {
      const list = byTag.get(tag.id) ?? []
      let plays = 0
      let seconds = 0
      for (const song of list) {
        plays += song.playCount
        seconds += song.duration
      }
      return { tag, songs: list, plays, seconds }
    })
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        b.songs.length - a.songs.length ||
        a.tag.name.localeCompare(b.tag.name),
    )
}

/** "20 songs · 1 h 22 min", under a tag in All tags. */
export function tagLine(standing: Pick<TagStanding, 'songs' | 'seconds'>): string {
  const count = standing.songs.length
  const songs = `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`
  return count === 0 ? songs : `${songs} · ${formatLongDuration(standing.seconds)}`
}

/** The tag this name already is, whatever the case, so a new tag never makes a twin. */
export function existingTag<T extends { name: string }>(
  tags: readonly T[],
  name: string,
): T | null {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return null
  return tags.find(tag => tag.name.trim().toLowerCase() === wanted) ?? null
}

/**
 * The artist a new tag's name would shadow (`P11`): making a tag called
 * exactly what the songs already call an artist first offers the artist.
 */
export function artistNamed(songs: readonly Song[], name: string): Artist | null {
  const key = artistKey(name)
  if (!key) return null
  return libraryArtists(songs).find(artist => artist.key === key) ?? null
}

/** One row of the Add sheet's list: a heading, or a place to turn on. */
export type AddRow =
  | { readonly kind: 'heading'; readonly title: string }
  | { readonly kind: 'place'; readonly place: Place }

/**
 * The Add sheet's two lists (`P09`), built for a library with hundreds of tags.
 *
 * Tags: the ones used lately first, then A to Z. Artists: A to Z. Typing
 * filters both and drops the headings, the matches best first.
 */
export function addSheetRows(input: {
  query: string
  tags: readonly Tag[]
  artists: readonly Artist[]
  recentTagIds: readonly number[]
  list: 'tags' | 'artists'
}): readonly AddRow[] {
  const query = input.query.trim()
  if (input.list === 'artists') {
    const artists = query
      ? fuzzyRank(query, input.artists, artist => artist.name).map(match => match.item)
      : [...input.artists].sort((a, b) => a.name.localeCompare(b.name))
    return artists.map(artist => ({ kind: 'place', place: { kind: 'artist', artist } }))
  }
  if (query) {
    return fuzzyRank(query, input.tags, tag => tag.name).map(match => ({
      kind: 'place' as const,
      place: { kind: 'tag' as const, tag: match.item },
    }))
  }
  const byId = new Map(input.tags.map(tag => [tag.id, tag]))
  const recent = input.recentTagIds.flatMap(id => {
    const tag = byId.get(id)
    return tag ? [tag] : []
  })
  const recentIds = new Set(recent.map(tag => tag.id))
  const rest = input.tags
    .filter(tag => !recentIds.has(tag.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  const asRows = (list: readonly Tag[]): AddRow[] =>
    list.map(tag => ({ kind: 'place', place: { kind: 'tag', tag } }))
  return [
    ...(recent.length > 0 ? [{ kind: 'heading' as const, title: 'Used lately' }] : []),
    ...asRows(recent),
    ...(recent.length > 0 && rest.length > 0
      ? [{ kind: 'heading' as const, title: 'A to Z' }]
      : []),
    ...asRows(rest),
  ]
}

/** Turn a place on or off in a set, keeping the order they were chosen in. */
export function togglePlace(chosen: readonly Place[], place: Place): readonly Place[] {
  const key = placeKey(place)
  return chosen.some(entry => placeKey(entry) === key)
    ? chosen.filter(entry => placeKey(entry) !== key)
    : [...chosen, place]
}

interface AlbumGroup {
  readonly album: string
  readonly year: number | null
  readonly songs: readonly Song[]
}

/**
 * An artist's songs by album (`P10`), newest album first, the tracks in their
 * order. Songs with no album gather at the end under no name.
 */
export function albumsOf(songs: readonly Song[]): AlbumGroup[] {
  const groups = new Map<string, Song[]>()
  for (const song of songs) {
    const key = song.album.trim()
    const list = groups.get(key)
    if (list) list.push(song)
    else groups.set(key, [song])
  }
  /** The album's latest year, where any of its songs says one. */
  const year = (list: readonly Song[]): number | null => {
    const years = list.flatMap(song => (song.year === null ? [] : [song.year]))
    return years.length > 0 ? Math.max(...years) : null
  }
  return [...groups]
    .map(([album, list]) => ({
      album,
      year: year(list),
      songs: [...list].sort(
        (a, b) => (a.trackNo ?? 999) - (b.trackNo ?? 999) || a.title.localeCompare(b.title),
      ),
    }))
    .sort(
      (a, b) =>
        Number(a.album === '') - Number(b.album === '') ||
        (b.year ?? 0) - (a.year ?? 0) ||
        a.album.localeCompare(b.album),
    )
}

/** "20 songs · 6 albums", under an artist's name. */
export function artistSummary(songs: readonly Song[]): string {
  const albums = new Set(songs.map(song => song.album.trim()).filter(Boolean)).size
  const count = `${songs.length.toLocaleString()} ${songs.length === 1 ? 'song' : 'songs'}`
  return albums > 0 ? `${count} · ${plural(albums, 'album', 'albums')}` : count
}
