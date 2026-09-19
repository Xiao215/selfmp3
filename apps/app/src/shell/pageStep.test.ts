import { describe, expect, it } from 'vitest'

import { pageKey, stackAnimation, stepSide } from './pageStep'

describe('what counts as a page change', () => {
  it('is the tab on a phone, so a page pushed within a tab is not one', () => {
    expect(pageKey('/', false)).toBe('/')
    expect(pageKey('/tag/rain', false)).toBe('/')
    expect(pageKey('/library', false)).toBe('/library')
    expect(pageKey('/playlists/4', false)).toBe('/playlists')
    expect(pageKey('/search', false)).toBe('/search')
  })

  it('is the page itself on a computer', () => {
    expect(pageKey('/tag/rain', true)).toBe('/tag/rain')
    expect(pageKey('/stats/report', true)).toBe('/stats/report')
  })

  it('leaves out the pages with entrances of their own', () => {
    expect(pageKey('/now-playing', false)).toBeNull()
    expect(pageKey('/now-playing', true)).toBeNull()
    expect(pageKey('/welcome', true)).toBeNull()
  })
})

describe('the side a phone page steps in from', () => {
  it('is the side its tab is on', () => {
    expect(stepSide('/', '/library')).toBe(1)
    expect(stepSide('/playlists', '/library')).toBe(-1)
    expect(stepSide('/library', '/search')).toBe(1)
  })
})

describe("the native stack's own move", () => {
  it('is none for a phone tab, whose step is the move', () => {
    expect(stackAnimation('library', false)).toEqual({ animation: 'none' })
    expect(stackAnimation('playlists/index', false)).toEqual({ animation: 'none' })
  })

  it('is a crossfade for a page pushed on a phone, longer for a place', () => {
    expect(stackAnimation('settings', false)).toEqual({ animation: 'fade' })
    expect(stackAnimation('tag/[name]', false)).toEqual({
      animation: 'fade',
      animationDuration: 340,
    })
  })

  it('is none on a computer, where the step is the whole page change', () => {
    expect(stackAnimation('settings', true)).toEqual({ animation: 'none' })
  })
})
