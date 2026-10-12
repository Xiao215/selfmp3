import { describe, expect, it } from 'vitest'
import type { RoomSong, SharedPlaylist, Song } from '@selfmp3/shared'
import { libraryIndex, roomTrackId } from '@selfmp3/client'
import { nameToJoinWith, sharedLine, sharedRows, sharedTracks } from './shared.model'

/** A shared playlist on this device: its rows, its tracks, its line. */

const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'

function song(n: number): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: null,
    title: `Song ${n}`,
    artist: '',
    album: '',
    duration: 100,
    audio: { key: `audio/${sha}.m4a`, size: 1, mime: 'audio/mp4' },
    cover: n === 1 ? { key: `covers/${sha}.jpg`, size: 0 } : null,
    coverTone: null,
    lyrics: null,
    sourceUrl: null,
    link: null,
    artwork: null,
  }
}

function playlist(you: string, creator: string): SharedPlaylist {
  return {
    id: '0123456789abcdef',
    name: 'Saturday',
    createdAt: 0,
    updatedAt: 0,
    members: [
      { id: X, name: 'Xiao', colour: 0, joinedAt: 0, creator: creator === X },
      { id: M, name: 'Mia', colour: 1, joinedAt: 0, creator: creator === M },
    ],
    entries: [
      { id: '000000000001', song: song(1), owner: X, addedAt: 0 },
      { id: '000000000002', song: song(2), owner: M, addedAt: 0 },
    ],
    you,
    invite: 'f'.repeat(16),
    token: 'e'.repeat(32),
  }
}

describe('a shared playlist here', () => {
  it('lets you take out your own songs, and whoever made it anyone’s', () => {
    expect(sharedRows(playlist(M, X)).map(row => row.removable)).toEqual([false, true])
    expect(sharedRows(playlist(X, X)).map(row => row.removable)).toEqual([true, true])
  })

  it('plays each song lent by the doorman, or your own copy', () => {
    const yours = { id: 7, path: song(2).audio?.key ?? '', sourceUrl: null } as Song
    const tracks = sharedTracks(
      playlist(X, X),
      (entry, part) => `doorman/${entry}/${part}`,
      libraryIndex([yours]),
    )
    expect(tracks.get(roomTrackId('000000000001'))).toMatchObject({
      stream: { url: 'doorman/000000000001/audio' },
      cover: 'doorman/000000000001/cover',
      yours: null,
    })
    expect(tracks.get(roomTrackId('000000000002'))?.yours).toBe(7)
  })

  it('says who is in it and how long it is', () => {
    expect(sharedLine(playlist(M, X), M)).toBe('Xiao and You · 2 songs')
  })

  it('joins with the first of your name', () => {
    expect(nameToJoinWith({ name: 'Xiao Zhang', email: 'x@example.com' })).toBe('Xiao')
    expect(nameToJoinWith({ name: null, email: 'mia@example.com' })).toBe('mia')
  })
})
