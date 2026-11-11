import { describe, expect, it } from 'vitest'
import { NEVER_LOOKED, storedIds, storedLook, storedOutbox } from './kept.js'
import { NO_IDS } from './snapshotLibrary.js'

const DEVICE = 'iphone-0b7d44a1'
const HLC = '0196a1b2c3d4.0000.iphone-0b7d44a1'

describe('reading back what this device kept', () => {
  it('takes a look kept from the future for none at all: the clock was put back', () => {
    const look = { checkedAt: 1_000, listedAt: 1_000, changes: 'a.1' }
    expect(storedLook(look, 2_000)).toEqual(look)
    expect(storedLook(look, 500)).toBe(NEVER_LOOKED)
    expect(storedLook({ checkedAt: 'soon' }, 2_000)).toBe(NEVER_LOOKED)
  })

  it('reads ids that are not ids as none handed out yet', () => {
    const ids = { songs: { a: 1 }, tags: {}, playlists: {}, next: 2 }
    expect(storedIds(ids)).toEqual(ids)
    expect(storedIds({ ...ids, next: '2' })).toBe(NO_IDS)
    expect(storedIds(null)).toBe(NO_IDS)
  })

  it('reads no outbox without its device and number, and sets aside a change it cannot read', () => {
    const warned: string[] = []
    const warn = (message: string): void => {
      warned.push(message)
    }
    expect(storedOutbox({ pending: [] }, true, warn)).toBeNull()

    const odd = { type: 'somethingNew', hlc: HLC }
    const outbox = storedOutbox(
      { device: DEVICE, nextSeq: 3, last: null, pending: [odd], inflight: null },
      true,
      warn,
    )
    expect(outbox).toMatchObject({ device: DEVICE, nextSeq: 3, pending: [] })
    expect(warned).toHaveLength(1)
  })
})
