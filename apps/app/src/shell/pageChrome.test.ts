import { describe, expect, it } from 'vitest'
import { pageOwnsScreen } from './pageChrome'

describe('pageOwnsScreen', () => {
  it('gives the whole display to the pages that own it everywhere', () => {
    for (const wide of [false, true]) {
      expect(pageOwnsScreen('/welcome', wide)).toBe(true)
      expect(pageOwnsScreen('/now-playing', wide)).toBe(true)
    }
  })

  it('leaves a tab its chrome', () => {
    expect(pageOwnsScreen('/', false)).toBe(false)
    expect(pageOwnsScreen('/library', false)).toBe(false)
    expect(pageOwnsScreen('/playlists', false)).toBe(false)
  })

  it('gives a phone’s Profile pages and Search the display, and their own sub-pages too', () => {
    for (const path of [
      '/profile',
      '/settings',
      '/search',
      '/import',
      '/import/review',
      '/stats',
      '/stats/report',
    ]) {
      expect(pageOwnsScreen(path, false)).toBe(true)
    }
  })

  it('keeps a computer’s sidebar and player bar on all of them', () => {
    for (const path of ['/profile', '/settings', '/search', '/import', '/stats/report']) {
      expect(pageOwnsScreen(path, true)).toBe(false)
    }
  })

  it('does not take a page whose name merely starts the same way', () => {
    expect(pageOwnsScreen('/searching', false)).toBe(false)
    expect(pageOwnsScreen('/importable', false)).toBe(false)
  })
})
