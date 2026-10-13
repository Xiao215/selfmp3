import { describe, expect, it } from 'vitest'

import { activeTab, TABS } from './nav.model'
import { fullScreenSwipeAllowed, swipeBackAllowed } from './backGesture'

describe('the swipe-back gesture', () => {
  it('is off on every page a tab points at, so no swipe changes tab', () => {
    for (const route of ['index', 'library', 'playlists/index']) {
      expect(swipeBackAllowed(route)).toBe(false)
    }
  })

  it('is off on a folder route spelled without its index', () => {
    expect(swipeBackAllowed('playlists')).toBe(false)
  })

  it('covers every tab in the bar', () => {
    // Changing tab pushes the tab's own page, and nothing else does, so the
    // pages that must refuse the gesture are exactly these three. A fourth tab
    // is covered the moment `activeTab` knows it.
    for (const { href } of TABS) {
      expect(activeTab(href)).toBe(href)
      expect(swipeBackAllowed(href === '/' ? 'index' : href.slice(1))).toBe(false)
    }
  })

  it('is off on the way in, which has nothing behind it', () => {
    expect(swipeBackAllowed('welcome')).toBe(false)
    expect(swipeBackAllowed('first-sync')).toBe(false)
  })

  it('stays on a page pushed from the one it goes back to', () => {
    for (const route of [
      'playlists/[id]',
      'import/index',
      'import/review',
      'profile',
      'settings',
      'stats/index',
      'stats/report',
      'tags',
      '+not-found',
    ]) {
      expect(swipeBackAllowed(route)).toBe(true)
    }
  })

  it('leaves Now Playing alone, where the swipe is a downward one', () => {
    // A `fullScreenModal` has no horizontal pop of its own; pulling it down to
    // close is `NowPlayingScreen`'s own responder.
    expect(swipeBackAllowed('now-playing')).toBe(true)
  })

  it("waits for the edge where a preview's bar drags sideways", () => {
    for (const route of ['import/review', 'import/search']) {
      expect(swipeBackAllowed(route)).toBe(true)
      expect(fullScreenSwipeAllowed(route)).toBe(false)
    }
  })

  it('keeps the whole-display swipe everywhere else', () => {
    for (const route of ['import/index', 'playlists/[id]', 'settings', 'stats/index', 'tags']) {
      expect(fullScreenSwipeAllowed(route)).toBe(true)
    }
  })
})
