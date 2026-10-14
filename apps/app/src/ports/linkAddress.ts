import { DEFAULT_APP_URL, DEFAULT_LINK_URL } from '@selfmp3/shared'
import { appAddress } from './shareLink'

/**
 * Where a share link points: the link domain (DEFAULT_LINK_URL), whose
 * address a chat app can draw a card for, wherever the app is the real one.
 * A development server's links stay on it, so they open where they were made.
 */
export function linkAddress(): string {
  const app = appAddress()
  return DEFAULT_LINK_URL && app === DEFAULT_APP_URL ? DEFAULT_LINK_URL : app
}
