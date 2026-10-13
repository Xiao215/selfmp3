import { linkIdentity, type RoomEntry, type RoomSong, type Song } from '@selfmp3/shared'

/**
 * A room's songs as the player knows songs (docs/features/listen-together.md).
 *
 * The player, its queue and every row are keyed by song id, and a song from a
 * friend's bucket has none on this device. So each room entry gets an id of
 * its own: negative, which no library ever hands out, and made from the
 * entry's id so the same entry is the same track however often the room is
 * read. Two entries of one song are two tracks, as two rows in Up next are.
 */

/** The player's id for a room entry: below zero, and the same every time. */
export function roomTrackId(entryId: string): number {
  return -(Number.parseInt(entryId.slice(0, 12), 16) + 1)
}

export function isRoomTrackId(songId: number): boolean {
  return songId < 0
}

/**
 * A room's entry — or a shared playlist's, which has the same parts — as a
 * library song, for the player and the rows that draw it.
 */
export function roomTrackSong(entry: Pick<RoomEntry, 'id' | 'song' | 'addedAt'>): Song {
  const song = entry.song
  return {
    id: roomTrackId(entry.id),
    path: song.audio?.key ?? song.link ?? '',
    title: song.title,
    artist: song.artist,
    album: song.album,
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: song.duration,
    sizeBytes: song.audio?.size ?? 0,
    mime: song.audio?.mime ?? 'audio/mp4',
    hasArt: song.cover !== null || song.artwork !== null,
    // A room's files are named by their hash, so the entry is a fine revision.
    rev: entry.id,
    coverTone: song.coverTone,
    lyricsKind: song.lyrics?.kind ?? 'none',
    instrumental: false,
    playCount: 0,
    loved: false,
    sourceUrl: song.sourceUrl,
    lastPlayedAt: null,
    addedAt: new Date(entry.addedAt).toISOString(),
    tagIds: [],
    audioFeatures: null,
  }
}

/** Your library's songs, looked up the two ways a room's song can be the same as one. */
export interface LibraryIndex {
  /** By audio key: the same file, since files are named by their hash. */
  readonly byAudio: ReadonlyMap<string, number>
  /** By the link it came from, as `linkIdentity` reads it. */
  readonly bySource: ReadonlyMap<string, number>
}

/**
 * A cloud library's songs carry their audio key as their path, so the same
 * file in a friend's bucket is the same key in yours.
 */
export function libraryIndex(songs: readonly Song[]): LibraryIndex {
  const byAudio = new Map<string, number>()
  const bySource = new Map<string, number>()
  for (const song of songs) {
    if (song.path.startsWith('audio/')) byAudio.set(song.path, song.id)
    const source = linkIdentity(song.sourceUrl)
    if (source) bySource.set(source, song.id)
  }
  return { byAudio, bySource }
}

/** Your own copy of a room's song, when you have one: it plays instead, and counts as yours. */
export function yoursOf(song: RoomSong, index: LibraryIndex): number | null {
  const byAudio = song.audio ? index.byAudio.get(song.audio.key) : undefined
  if (byAudio !== undefined) return byAudio
  const source = linkIdentity(song.sourceUrl ?? song.link)
  return (source ? index.bySource.get(source) : undefined) ?? null
}
