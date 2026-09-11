import {
  fromCloudRules,
  type CloudSnapshot,
  type Library,
  type Playlist,
  type Song,
  type Tag,
} from '@selfmp3/shared'

/**
 * A snapshot from the bucket, as the library the app already knows how to
 * show (docs/SYNC.md).
 *
 * The bucket names songs, tags and playlists by uid; the whole app works with
 * small integer ids. So each uid gets an id on this device — handed out once,
 * remembered, and never given to anything else — and the rest is a matter of
 * renaming fields. Pure, so it can be tested without a browser.
 */

/** This device's ids for the bucket's uids. Only ever grows. */
export interface LocalIds {
  readonly songs: Readonly<Record<string, number>>
  readonly tags: Readonly<Record<string, number>>
  readonly playlists: Readonly<Record<string, number>>
  /** The next id to hand out, shared by all three kinds so no two things ever share one. */
  readonly next: number
}

export const NO_IDS: LocalIds = { songs: {}, tags: {}, playlists: {}, next: 1 }

/** Where a song's files are in the bucket, for downloads and the service worker. */
export interface SongFiles {
  readonly audio: string
  readonly cover: string | null
  readonly lyrics: string | null
  readonly lyricsKind: 'plain' | 'synced' | null
}

export interface CloudLibrary {
  readonly library: Library
  readonly ids: LocalIds
  readonly files: Readonly<Record<number, SongFiles>>
  /** Each playlist's songs, in order — smart ones as the snapshot resolved them. */
  readonly playlistSongs: Readonly<Record<number, readonly number[]>>
  /** The uid behind each id in this library, for turning an edit into a change. */
  readonly uids: {
    readonly songs: ReadonlyMap<number, string>
    readonly tags: ReadonlyMap<number, string>
    readonly playlists: ReadonlyMap<number, string>
  }
}

export function snapshotToLibrary(
  snapshot: CloudSnapshot,
  previous: LocalIds,
  version: number,
): CloudLibrary {
  const songs = { ...previous.songs }
  const tags = { ...previous.tags }
  const playlists = { ...previous.playlists }
  let next = previous.next
  const idFor = (table: Record<string, number>, uid: string): number => {
    const known = table[uid]
    if (known !== undefined) return known
    const id = next++
    table[uid] = id
    return id
  }

  const tagIdOf = new Map(snapshot.tags.map(tag => [tag.uid, idFor(tags, tag.uid)]))
  const songCountByTag = new Map<number, number>()
  const files: Record<number, SongFiles> = {}
  const songIdOf = new Map<string, number>()

  const librarySongs: Song[] = snapshot.songs.map(song => {
    const id = idFor(songs, song.uid)
    songIdOf.set(song.uid, id)
    const tagIds = song.tagUids.flatMap(uid => {
      const tagId = tagIdOf.get(uid)
      return tagId === undefined ? [] : [tagId]
    })
    for (const tagId of tagIds) songCountByTag.set(tagId, (songCountByTag.get(tagId) ?? 0) + 1)
    files[id] = {
      audio: song.audio.key,
      cover: song.cover?.key ?? null,
      lyrics: song.lyrics?.key ?? null,
      lyricsKind: song.lyrics?.kind ?? null,
    }

    return {
      id,
      // The audio's key stands in for a path: the one place a song's file is.
      path: song.audio.key,
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumArtist: song.albumArtist,
      trackNo: song.trackNo,
      year: song.year,
      duration: song.duration,
      sizeBytes: song.audio.size,
      mime: song.audio.mime,
      hasArt: song.cover !== null,
      // Changes exactly when the audio or the cover does, so media URLs never
      // serve an old file: both are named by their hash.
      rev: `${hashOf(song.audio.key)}.${song.cover ? hashOf(song.cover.key) : '0'}`,
      lyricsKind: song.lyrics?.kind ?? 'none',
      instrumental: song.instrumental,
      playCount: song.playCount,
      skipCount: song.skipCount,
      loved: song.loved,
      sourceUrl: song.sourceUrl,
      lastPlayedAt: song.lastPlayedAt,
      addedAt: song.addedAt,
      missing: false,
      tagIds,
      features: song.features,
    }
  })

  const libraryTags: Tag[] = snapshot.tags.map(tag => {
    const id = tagIdOf.get(tag.uid) ?? idFor(tags, tag.uid)
    return { id, name: tag.name, hue: tag.hue, songCount: songCountByTag.get(id) ?? 0 }
  })

  const durationOf = new Map(librarySongs.map(song => [song.id, song.duration]))
  const playlistSongs: Record<number, number[]> = {}
  const libraryPlaylists: Playlist[] = snapshot.playlists.map(playlist => {
    const id = idFor(playlists, playlist.uid)
    const songIds = playlist.songUids.flatMap(uid => {
      const songId = songIdOf.get(uid)
      return songId === undefined ? [] : [songId]
    })
    playlistSongs[id] = songIds
    return {
      id,
      name: playlist.name,
      description: playlist.description,
      kind: playlist.kind,
      rules: playlist.rules
        ? fromCloudRules(playlist.rules, uid => tagIdOf.get(uid) ?? null)
        : null,
      songCount: songIds.length,
      totalDuration: songIds.reduce((sum, songId) => sum + (durationOf.get(songId) ?? 0), 0),
      pinned: playlist.pinned,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
    }
  })

  return {
    library: {
      songs: librarySongs,
      tags: libraryTags,
      playlists: libraryPlaylists,
      version,
      generatedAt: snapshot.writtenAt,
    },
    ids: { songs, tags, playlists, next },
    files,
    playlistSongs,
    uids: {
      songs: new Map(snapshot.songs.map(song => [songs[song.uid] ?? 0, song.uid])),
      tags: new Map(snapshot.tags.map(tag => [tags[tag.uid] ?? 0, tag.uid])),
      playlists: new Map(
        snapshot.playlists.map(playlist => [playlists[playlist.uid] ?? 0, playlist.uid]),
      ),
    },
  }
}

/** `audio/4f1c….m4a` → the first twelve characters of its hash. */
function hashOf(key: string): string {
  return (/\/([0-9a-f]{12})/.exec(key)?.[1] ?? key).slice(0, 12)
}
