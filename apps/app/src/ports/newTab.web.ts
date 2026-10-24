import { appPath } from './appPath'
import { desktop } from './desktop/bridge'

/**
 * See `newTab.ts`. A browser opens the page in a new tab (Links you shared,
 * K1). The Mac app has no tabs, and a second window of it would be a second
 * player, so it opens the page in place, as a phone does.
 */
export function hasTabs(): boolean {
  return desktop === null && typeof window !== 'undefined'
}

export function openInNewTab(path: string): boolean {
  if (!hasTabs()) return false
  // With `noopener` the browser hands back no window, so there is nothing to check.
  window.open(appPath(path), '_blank', 'noopener')
  return true
}
