import { describe, expect, it } from 'vitest'

import { activeDestination, activeTab } from './bottomNav.model'

describe('the tab bar', () => {
  it('lights the tab a page belongs to', () => {
    expect(activeTab('/')).toBe('/')
    expect(activeTab('/library')).toBe('/library')
    expect(activeTab('/playlists')).toBe('/playlists')
    expect(activeTab('/playlists/12')).toBe('/playlists')
  })

  it('lights Home on every page that is reached from Home', () => {
    for (const page of [
      '/tags',
      '/profile',
      '/settings',
      '/stats',
      '/stats/report',
      '/import',
      '/import/migrate',
      '/tag/night%20drive',
      '/artist/Yorushika',
    ]) {
      expect(activeTab(page)).toBe('/')
    }
  })

  it('lights nothing for a page no tab leads to', () => {
    expect(activeTab('/now-playing')).toBeNull()
    expect(activeTab('/statsomething')).toBeNull()
    expect(activeTab('/libraryish')).toBeNull()
    // Search is no tab's page; the bar keeps the one it was opened from lit.
    expect(activeTab('/search')).toBeNull()
  })
})
describe('the rail’s own destinations', () => {
  const RAIL = ['/', '/library', '/import', '/stats']

  it('lights the page’s own destination, and the longest one that fits', () => {
    expect(activeDestination('/', RAIL)).toBe('/')
    expect(activeDestination('/library', RAIL)).toBe('/library')
    expect(activeDestination('/stats/report', RAIL)).toBe('/stats')
  })

  it('lights nothing for a name that merely starts the same way', () => {
    expect(activeDestination('/statsomething', RAIL)).toBeNull()
  })

  it('lights nothing for a page the rail does not carry', () => {
    expect(activeDestination('/tag/yoasobi', RAIL)).toBeNull()
    expect(activeDestination('/profile', RAIL)).toBeNull()
  })
})
