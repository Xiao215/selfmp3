import { describe, expect, it } from 'vitest'

import { activeTab } from '../ui/components/bottomNav.model'
import { swipeBackAllowed } from './backGesture'

/** The four tabs the bar draws, as `BottomNav` lists them. */
const TABS = ['/', '/playlists', '/import', '/you']

describe('the swipe-back gesture', () => {
  it('is off on every page a tab points at, so no swipe changes tab', () => {
    for (const route of ['index', 'playlists/index', 'import/index', 'you']) {
      expect(swipeBackAllowed(route)).toBe(false)
    }
  })

  it('is off on a folder route spelled without its index', () => {
    expect(swipeBackAllowed('playlists')).toBe(false)
    expect(swipeBackAllowed('import')).toBe(false)
  })

  it('covers every tab in the bar', () => {
    // Changing tab pushes the tab's own page, and nothing else does, so the
    // pages that must refuse the gesture are exactly these four. A fifth tab
    // is covered the moment `activeTab` knows it.
    for (const href of TABS) {
      expect(activeTab(href)).toBe(href)
      expect(swipeBackAllowed(href === '/' ? 'index' : href.slice(1))).toBe(false)
    }
  })

  it('is off on the way in, which has nothing behind it', () => {
    expect(swipeBackAllowed('sign-in')).toBe(false)
    expect(swipeBackAllowed('onboarding')).toBe(false)
  })

  it('stays on a page pushed from the one it goes back to', () => {
    for (const route of [
      'playlists/[id]',
      'import/migrate',
      'settings',
      'stats/index',
      'stats/report',
      'inbox',
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
})
