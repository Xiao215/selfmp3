import { describe, expect, it } from 'vitest'
import { EMPTY_QUEUE, type QueueState } from '@selfmp3/shared'
import { launchPlayback, parseSession, sessionFromQueue } from './session.model'

const queue = (items: number[], index: number): QueueState => ({
  ...EMPTY_QUEUE,
  items,
  original: items,
  index,
})
const known = (...ids: number[]): ReadonlySet<number> => new Set(ids)

describe('the saved session', () => {
  it('survives being written and read back', () => {
    const saved = sessionFromQueue(queue([3, 1, 2], 1), 42.5)
    expect(parseSession(JSON.stringify(saved))).toEqual({
      queueIds: [3, 1, 2],
      index: 1,
      position: 42.5,
    })
  })

  it('keeps nothing for an empty queue, and reads nothing from junk', () => {
    expect(sessionFromQueue(EMPTY_QUEUE, 10)).toBeNull()
    expect(parseSession(null)).toBeNull()
    expect(parseSession('not json')).toBeNull()
    expect(parseSession(JSON.stringify({ queueIds: [1, 2], index: 5, position: 1 }))).toBeNull()
    expect(parseSession(JSON.stringify({ queueIds: ['a'], index: 0, position: 1 }))).toBeNull()
  })
})

describe('launchPlayback', () => {
  const saved = parseSession(JSON.stringify({ queueIds: [4, 9, 4, 7], index: 2, position: 61 }))

  it('comes back to the saved song and position, without songs since removed', () => {
    expect(launchPlayback(saved, undefined, known(4, 7))).toEqual({
      queueIds: [4, 4, 7],
      index: 1,
      position: 61,
    })
  })

  it('keeps the session when the address names the same song', () => {
    expect(launchPlayback(saved, '4', known(4, 9, 7))?.position).toBe(61)
  })

  it('plays the song an address names when it is another one', () => {
    expect(launchPlayback(saved, '9', known(4, 9, 7))).toEqual({
      queueIds: [9],
      index: 0,
      position: 0,
    })
  })

  it('ignores an address naming nothing it knows, and has nothing when the song is gone', () => {
    expect(launchPlayback(saved, '99', known(4, 9, 7))?.index).toBe(2)
    expect(launchPlayback(saved, 'abc', known(4, 9, 7))?.index).toBe(2)
    expect(launchPlayback(saved, undefined, known(9, 7))).toBeNull()
    expect(launchPlayback(null, '7', known(7))).toEqual({ queueIds: [7], index: 0, position: 0 })
  })
})
