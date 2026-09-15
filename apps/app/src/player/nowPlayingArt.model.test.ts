import { describe, expect, it } from 'vitest'

import { nowPlayingArtwork } from './nowPlayingArt.model'

const song = { id: 7, rev: 'r2', hasArt: true }
const serverArt = (songId: number, rev: string): string => `http://server/api/art/${songId}?v=${rev}`

describe('the Now Playing cover', () => {
  it('is the copy on this device whenever there is one', () => {
    expect(nowPlayingArtwork(song, { kept: 'file:///covers/7.jpg', serverArt })).toBe('file:///covers/7.jpg')
    expect(nowPlayingArtwork(song, { kept: 'file:///covers/7.jpg', serverArt: null })).toBe('file:///covers/7.jpg')
  })

  it('is the server’s address for a server library with nothing kept yet', () => {
    expect(nowPlayingArtwork(song, { kept: undefined, serverArt })).toBe('http://server/api/art/7?v=r2')
  })

  it('is none for a cloud library until its cover is on this device', () => {
    expect(nowPlayingArtwork(song, { kept: undefined, serverArt: null })).toBeNull()
  })

  it('is none for a song with no cover, whatever is lying around', () => {
    const bare = { ...song, hasArt: false }
    expect(nowPlayingArtwork(bare, { kept: 'file:///covers/7.jpg', serverArt })).toBeNull()
  })
})
