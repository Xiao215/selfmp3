import { describe, expect, it } from 'vitest'

import { activeTab } from './bottomNav.model'

describe('the tab bar', () => {
  it('lights the tab a page belongs to', () => {
    expect(activeTab('/')).toBe('/')
    expect(activeTab('/playlists')).toBe('/playlists')
    expect(activeTab('/playlists/12')).toBe('/playlists')
    expect(activeTab('/import')).toBe('/import')
    expect(activeTab('/import/migrate')).toBe('/import')
  })

  it('lights You on every page You lists', () => {
    for (const page of ['/you', '/settings', '/stats', '/stats/report', '/inbox', '/tags']) {
      expect(activeTab(page)).toBe('/you')
    }
  })

  it('lights nothing for a page no tab leads to', () => {
    expect(activeTab('/now-playing')).toBeNull()
    expect(activeTab('/statsomething')).toBeNull()
  })
})
