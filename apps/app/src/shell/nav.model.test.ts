import { describe, expect, it } from 'vitest'

import { activeDestination, activeTab, navGoes, navItemProps, TABS } from './nav.model'

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
      '/import/review',
      '/tag/night%20drive',
      '/artist/Yorushika',
      '/combined',
      '/past-room/KQ7482',
    ]) {
      expect(activeTab(page)).toBe('/')
    }
  })

  it('lights Playlists on a shared playlist, which sits among them', () => {
    expect(activeTab('/shared/0123456789abcdef')).toBe('/playlists')
    expect(activeTab('/shared/0123456789abcdef/join/fedcba9876543210')).toBe('/playlists')
    expect(activeTab('/sharedthing')).toBeNull()
  })

  it('lights nothing for a page no tab leads to', () => {
    expect(activeTab('/now-playing')).toBeNull()
    expect(activeTab('/statsomething')).toBeNull()
    expect(activeTab('/libraryish')).toBeNull()
    // Search is no tab's page; the bar keeps the one it was opened from lit.
    expect(activeTab('/search')).toBeNull()
    // An Ask answer is reached from Search, which is no tab's either.
    expect(activeTab('/answer')).toBeNull()
  })
})
describe('the rail’s own destinations', () => {
  it('lights the page’s own destination, and the longest one that fits', () => {
    expect(activeDestination('/')).toBe('/')
    expect(activeDestination('/library')).toBe('/library')
    expect(activeDestination('/stats/report')).toBe('/stats')
    expect(activeDestination('/playlists/3')).toBe('/playlists')
  })

  it('lights nothing for a name that merely starts the same way', () => {
    expect(activeDestination('/statsomething')).toBeNull()
  })

  it('lights nothing for a page the rail does not carry', () => {
    expect(activeDestination('/tag/yoasobi')).toBeNull()
    expect(activeDestination('/profile')).toBeNull()
  })
})

describe('pressing a place', () => {
  it('goes back to a lit place’s first page from a page inside it', () => {
    expect(navGoes('/stats/report', '/stats')).toBe(true)
    expect(navGoes('/playlists/3', '/playlists')).toBe(true)
    expect(navGoes('/settings', '/')).toBe(true)
  })

  it('stays put on the place’s first page itself', () => {
    expect(navGoes('/stats', '/stats')).toBe(false)
    expect(navGoes('/', '/')).toBe(false)
  })
})

describe('what a place says', () => {
  it('is a tab that says whether it is chosen, on the web as well', () => {
    expect(navItemProps(true)).toEqual({
      accessibilityRole: 'tab',
      accessibilityState: { selected: true },
      'aria-selected': true,
    })
    expect(navItemProps(false)['aria-selected']).toBe(false)
  })

  it('gives the phone three tabs, each its own page’s', () => {
    expect(TABS.map(tab => tab.href)).toEqual(['/', '/library', '/playlists'])
    for (const tab of TABS) expect(activeTab(tab.href)).toBe(tab.href)
  })
})
