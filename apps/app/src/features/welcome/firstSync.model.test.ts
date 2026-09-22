import { describe, expect, it } from 'vitest'

import {
  afterWelcome,
  arrival,
  FIRST_SYNC_SEEN,
  firstSyncDue,
  helloLine,
  keepEverySongByDefault,
  keepEverySongCopy,
  stackRest,
  type LibrarySoFar,
} from './firstSync.model'

/**
 * First sync's rules: that it happens once, only after Google, and that its
 * switch starts where `S3` says it does on each kind of device.
 */
describe('whether First sync is due', () => {
  it('is due on a device that has never seen it', () => {
    expect(firstSyncDue(null)).toBe(true)
  })

  it('is not due again once seen', () => {
    expect(firstSyncDue(FIRST_SYNC_SEEN)).toBe(false)
  })

  it('follows a first Google sign-in', () => {
    expect(afterWelcome(true, null, true)).toBe('/first-sync')
  })

  it('does not follow a second one on the same device', () => {
    expect(afterWelcome(true, FIRST_SYNC_SEEN, true)).toBe('/')
  })

  it('does not follow a server address, which the simulator tests type', () => {
    expect(afterWelcome(false, null, true)).toBe('/')
  })

  it('skips it in a browser, which keeps nothing and has nothing to wait for', () => {
    expect(afterWelcome(true, null, false)).toBe('/')
  })
})

describe('Keep every song', () => {
  it('starts off on a phone and on on a computer', () => {
    expect(keepEverySongByDefault(false)).toBe(false)
    expect(keepEverySongByDefault(true)).toBe(true)
  })

  it('names the device it keeps songs on', () => {
    expect(keepEverySongCopy(false, null).label).toBe('Keep every song on this phone')
    expect(keepEverySongCopy(true, null).label).toBe('Keep every song on this computer')
  })

  it('says how much it would hold once the library is known', () => {
    expect(keepEverySongCopy(false, 310 * 1024 * 1024).hint).toMatch(/^About 310 MB\. /)
    expect(keepEverySongCopy(false, null).hint).not.toMatch(/About/)
    expect(keepEverySongCopy(true, 0).hint).not.toMatch(/About/)
  })
})

describe('helloLine', () => {
  it('uses the first name only', () => {
    expect(helloLine('Xiao Zhang')).toBe('Hello, Xiao')
    expect(helloLine('  Xiao  ')).toBe('Hello, Xiao')
  })

  it('says plain hello with no name', () => {
    expect(helloLine(null)).toBe('Hello')
    expect(helloLine('   ')).toBe('Hello')
  })
})

describe('arrival', () => {
  const library: LibrarySoFar = {
    songs: 45,
    tags: 8,
    playlists: 4,
    withArt: 45,
    coversHere: 31,
    keepsCovers: true,
  }

  it('says nothing yet while the library is on its way', () => {
    expect(arrival(null)).toEqual({ summary: null, detail: null, fraction: 0 })
  })

  it('counts the library and the covers so far, as P03 does', () => {
    const now = arrival(library)
    expect(now.summary).toBe('45 songs · 8 tags · 4 playlists')
    expect(now.detail).toBe('31 of 45 covers so far')
    expect(now.fraction).toBeCloseTo(31 / 45)
  })

  it('counts one of a thing as one', () => {
    expect(arrival({ ...library, songs: 1, tags: 1, playlists: 1 }).summary).toBe(
      '1 song · 1 tag · 1 playlist',
    )
  })

  it('fills the bar once every cover is here', () => {
    expect(arrival({ ...library, coversHere: 45 })).toMatchObject({
      detail: 'Every cover is here',
      fraction: 1,
    })
  })

  it('has nothing to wait for where covers are not kept, or there are none', () => {
    expect(arrival({ ...library, keepsCovers: false })).toMatchObject({ detail: null, fraction: 1 })
    expect(arrival({ ...library, withArt: 0 })).toMatchObject({ detail: null, fraction: 1 })
  })
})

describe('stackRest', () => {
  it('counts every song the stack does not show', () => {
    expect(stackRest(45, 3)).toBe(42)
    expect(stackRest(2, 3)).toBe(0)
  })
})
