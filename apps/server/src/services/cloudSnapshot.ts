import {
  CLOUD_FORMAT,
  CloudSnapshotSchema,
  toCloudRules,
  type CloudPlaylist,
  type CloudSnapshot,
  type CloudSong,
  type Playlist,
  type Song,
  type Tag,
} from '@selfmp3/shared'
import type { CloudSongState } from '../repositories/cloud.js'

/**
 * The library as a snapshot for the bucket (docs/SYNC.md): pure, so what goes
 * out can be tested without a bucket or a server.
 *
 * Only songs whose audio is uploaded are in it. A song whose file has gone
 * missing on this Mac since is still in it — the bucket has its audio, which
 * is the point of having one — until the song is forgotten for good.
 */
export interface SnapshotInput {
  readonly songs: readonly Song[]
  readonly songUids: ReadonlyMap<number, string>
  readonly states: ReadonlyMap<number, CloudSongState>
  readonly tags: readonly Tag[]
  readonly tagUids: ReadonlyMap<number, string>
  readonly playlists: readonly Playlist[]
  readonly playlistUids: ReadonlyMap<number, string>
  /** Song ids in playlist order; smart playlists resolved as they stand. */
  readonly playlistSongIds: (playlist: Playlist) => readonly number[]
  readonly deviceId: string
  readonly writtenAt: Date
}

export function buildSnapshot(input: SnapshotInput): CloudSnapshot {
  const songs: CloudSong[] = []
  const published = new Map<number, string>()

  for (const song of input.songs) {
    const state = input.states.get(song.id)
    const uid = input.songUids.get(song.id)
    if (!state || !uid) continue
    published.set(song.id, uid)

    songs.push({
      uid,
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumArtist: song.albumArtist,
      trackNo: song.trackNo,
      year: song.year,
      duration: song.duration,
      audio: { key: state.audioKey, size: state.audioSize, mime: song.mime },
      cover: state.coverKey !== null ? { key: state.coverKey, size: state.coverSize ?? 0 } : null,
      lyrics:
        state.lyricsKey !== null && state.lyricsKind !== null
          ? { key: state.lyricsKey, size: state.lyricsSize ?? 0, kind: state.lyricsKind }
          : null,
      instrumental: song.instrumental,
      loved: song.loved,
      playCount: song.playCount,
      skipCount: song.skipCount,
      lastPlayedAt: song.lastPlayedAt,
      addedAt: song.addedAt,
      sourceUrl: song.sourceUrl,
      tagUids: song.tagIds.flatMap(id => {
        const tagUid = input.tagUids.get(id)
        return tagUid ? [tagUid] : []
      }),
      features: song.features,
    })
  }

  const tagUid = (id: number): string | null => input.tagUids.get(id) ?? null

  const playlists: CloudPlaylist[] = []
  for (const playlist of input.playlists) {
    const uid = input.playlistUids.get(playlist.id)
    if (!uid) continue
    playlists.push({
      uid,
      name: playlist.name,
      description: playlist.description,
      kind: playlist.kind,
      rules:
        playlist.kind === 'smart' && playlist.rules ? toCloudRules(playlist.rules, tagUid) : null,
      pinned: playlist.pinned,
      songUids: input.playlistSongIds(playlist).flatMap(id => {
        const songUid = published.get(id)
        return songUid ? [songUid] : []
      }),
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
    })
  }

  // Parsed on the way out as well as on the way in: a snapshot another device
  // would reject is a bug here, and it should fail here, loudly.
  return CloudSnapshotSchema.parse({
    format: CLOUD_FORMAT,
    writtenAt: input.writtenAt.toISOString(),
    writtenBy: input.deviceId,
    upTo: {},
    songs,
    tags: input.tags.flatMap(tag => {
      const uid = input.tagUids.get(tag.id)
      return uid ? [{ uid, name: tag.name, hue: tag.hue }] : []
    }),
    playlists,
  })
}
