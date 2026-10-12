import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import { roomSongOf } from './roomSong.js'

/** One of your songs as a listening room carries it: its words, and its files' keys. */

const SHA = 'ab'.repeat(32)

const SONG = {
  id: 7,
  title: 'ヒッチコック',
  artist: 'ヨルシカ',
  album: '負け犬にアンコールはいらない',
  duration: 263,
  sizeBytes: 4000,
  mime: 'audio/mp4',
  coverTone: null,
  sourceUrl: 'https://music.youtube.com/watch?v=abc',
} as Song

const FILES = {
  audio: `audio/${SHA}.m4a`,
  cover: `covers/${SHA}.jpg`,
  lyrics: `lyrics/${SHA}.lrc`,
  lyricsKind: 'synced' as const,
  romanized: `lyrics/${'cd'.repeat(32)}.json`,
  motion: null,
}

describe('a song of yours in a room', () => {
  it('carries its words and its files’ keys, and where it came from', () => {
    expect(roomSongOf(SONG, FILES, 'ef'.repeat(16))).toMatchObject({
      uid: 'ef'.repeat(16),
      title: 'ヒッチコック',
      audio: { key: FILES.audio, size: 4000, mime: 'audio/mp4' },
      cover: { key: FILES.cover },
      lyrics: { key: FILES.lyrics, kind: 'synced', romanized: FILES.romanized },
      sourceUrl: SONG.sourceUrl,
      link: null,
    })
  })

  it('leaves out a source that is not a link', () => {
    expect(
      roomSongOf({ ...SONG, sourceUrl: 'imported from a folder' }, FILES, null)?.sourceUrl,
    ).toBeNull()
  })

  it('is no room song when its audio is not where a room can lend it from', () => {
    expect(roomSongOf(SONG, { ...FILES, audio: 'music/song.m4a' }, null)).toBeNull()
  })
})
