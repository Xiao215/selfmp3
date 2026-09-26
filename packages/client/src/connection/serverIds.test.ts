import { describe, expect, it } from 'vitest'
import { songIdTranslation } from './serverIds.js'

const uid = (letter: string) => letter.repeat(32)

const device = {
  songs: [
    { id: 1, uid: uid('a') },
    { id: 2, uid: uid('b') },
    { id: 3, uid: uid('c') },
  ],
}
const server = {
  songs: [
    { id: 812, uid: uid('b') },
    { id: 813, uid: uid('a') },
    { id: 814, uid: uid('d') },
  ],
}

describe('songIds', () => {
  it('translates both ways through the uid both libraries know a song by', () => {
    const ids = songIdTranslation(device, server)
    expect(ids.ready).toBe(true)
    expect(ids.onServer(1)).toBe(813)
    expect(ids.onServer(2)).toBe(812)
    expect(ids.onDevice(813)).toBe(1)
    expect(ids.onDevice(812)).toBe(2)
  })

  it('has no answer for a song only one of the two has', () => {
    const ids = songIdTranslation(device, server)
    // A song in this device's copy that the server has no number for…
    expect(ids.onServer(3)).toBeUndefined()
    // …and one the server has that this device has never seen.
    expect(ids.onDevice(814)).toBeUndefined()
  })

  it('is not ready, and answers nothing, until both lists are in', () => {
    for (const ids of [
      songIdTranslation(undefined, server),
      songIdTranslation(device, undefined),
      songIdTranslation(undefined, undefined),
    ]) {
      expect(ids.ready).toBe(false)
      expect(ids.onServer(1)).toBeUndefined()
      expect(ids.onDevice(812)).toBeUndefined()
    }
  })
})
