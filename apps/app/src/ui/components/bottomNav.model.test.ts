import { describe, expect, it } from 'vitest'

import { activeTab } from './bottomNav.model'

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
      '/you',
      '/settings',
      '/stats',
      '/stats/report',
      '/import',
      '/import/migrate',
      '/inbox',
    ]) {
      expect(activeTab(page)).toBe('/')
    }
  })

  it('lights nothing for a page no tab leads to', () => {
    expect(activeTab('/now-playing')).toBeNull()
    expect(activeTab('/statsomething')).toBeNull()
    expect(activeTab('/libraryish')).toBeNull()
  })
})
