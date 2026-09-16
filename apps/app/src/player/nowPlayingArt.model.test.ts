import { describe, expect, it } from 'vitest'

import { nowPlayingArtwork } from './nowPlayingArt.model'

const song = { id: 7, rev: 'r2', hasArt: true }
const remoteArt = (songId: number, rev: string): string =>
  `http://server/api/art/${songId}?v=${rev}`
const nowhere = (): null => null

describe('the Now Playing cover', () => {
  it('is the copy on this device whenever there is one', () => {
    expect(nowPlayingArtwork(song, { kept: 'file:///covers/7.jpg', remoteArt })).toBe(
      'file:///covers/7.jpg',
    )
    expect(nowPlayingArtwork(song, { kept: 'file:///covers/7.jpg', remoteArt: nowhere })).toBe(
      'file:///covers/7.jpg',
    )
  })

  it('is this library’s address when nothing is kept yet', () => {
    expect(nowPlayingArtwork(song, { kept: undefined, remoteArt })).toBe(
      'http://server/api/art/7?v=r2',
    )
  })

  it('is none where nothing here can serve the picture', () => {
    expect(nowPlayingArtwork(song, { kept: undefined, remoteArt: nowhere })).toBeNull()
  })

  it('is none for a song with no cover, whatever is lying around', () => {
    const bare = { ...song, hasArt: false }
    expect(nowPlayingArtwork(bare, { kept: 'file:///covers/7.jpg', remoteArt })).toBeNull()
  })
})
