import { describe, expect, it } from 'vitest'

import { WELCOME_FAN, WELCOME_TILES, welcomeArt, welcomeFootnote } from './welcome.model'

/**
 * Welcome's two faces. Worth pinning because the wrong one is quietly wrong: a
 * returning device greeted with made-up tags, or a fan with a gap in it.
 */
describe('welcomeArt', () => {
  it('shows the invented tiles on a device that kept no covers', () => {
    expect(welcomeArt([])).toEqual({ kind: 'tiles', tiles: WELCOME_TILES })
  })

  it('shows the tiles rather than a fan with gaps in it', () => {
    expect(welcomeArt(['a', 'b']).kind).toBe('tiles')
    // The same cover twice is one cover.
    expect(welcomeArt(['a', 'a', 'b']).kind).toBe('tiles')
  })

  it('fans out the covers this device kept, with a fourth behind them', () => {
    expect(welcomeArt(['a', 'b', 'c', 'd', 'e'])).toEqual({
      kind: 'covers',
      fan: ['a', 'b', 'c'],
      backdrop: 'd',
    })
  })

  it('lights the page with the first cover when there are only three', () => {
    const art = welcomeArt(['a', 'b', 'c'])
    expect(art).toEqual({ kind: 'covers', fan: ['a', 'b', 'c'], backdrop: 'a' })
    expect(art.kind === 'covers' && art.fan).toHaveLength(WELCOME_FAN)
  })
})

describe('the invented tiles', () => {
  it('are a handful, each with its own name and hue', () => {
    expect(WELCOME_TILES.length).toBeGreaterThanOrEqual(4)
    expect(new Set(WELCOME_TILES.map(tile => tile.name)).size).toBe(WELCOME_TILES.length)
    expect(new Set(WELCOME_TILES.map(tile => tile.hue)).size).toBe(WELCOME_TILES.length)
  })

  it('are named as a tag is: lowercase words, short enough for a tile', () => {
    for (const tile of WELCOME_TILES) {
      expect(tile.name).toBe(tile.name.toLowerCase())
      expect(tile.name.length).toBeLessThanOrEqual(12)
    }
  })
})

describe('welcomeFootnote', () => {
  it('names the device it is on', () => {
    expect(welcomeFootnote(false)).toMatch(/this phone/)
    expect(welcomeFootnote(true)).toMatch(/this computer/)
    // Not "the server runs here": a browser tab is not where the server is.
    expect(welcomeFootnote(true)).not.toMatch(/server runs here/)
  })
})
