import { RoomSongSchema, type RoomSong, type Song } from '@selfmp3/shared'
import type { SongFiles } from './snapshotLibrary.js'

/**
 * One of your songs as a room carries it (docs/features/listen-together.md):
 * its words and its files' keys, which the doorman lends to the room from your
 * bucket. Null for a song the room could not play — one whose audio is not
 * in the bucket under a key a room accepts.
 *
 * The sizes of a cover and of the words are not kept on this device, and
 * nothing reads them from a room, so they go as zero.
 */
export function roomSongOf(song: Song, files: SongFiles, uid: string | null): RoomSong | null {
  const parsed = RoomSongSchema.safeParse({
    uid,
    title: song.title.slice(0, 300) || 'Untitled',
    artist: song.artist.slice(0, 300),
    album: song.album.slice(0, 300),
    duration: Math.min(song.duration, 36_000),
    audio: { key: files.audio, size: song.sizeBytes, mime: song.mime },
    cover: files.cover ? { key: files.cover, size: 0 } : null,
    coverTone: song.coverTone,
    lyrics:
      files.lyrics && files.lyricsKind
        ? { key: files.lyrics, size: 0, kind: files.lyricsKind }
        : null,
    sourceUrl: song.sourceUrl && isUrl(song.sourceUrl) ? song.sourceUrl : null,
    link: null,
    artwork: null,
  })
  return parsed.success ? parsed.data : null
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text)
}
