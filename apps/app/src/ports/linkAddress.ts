import { DEFAULT_APP_URL } from '@selfmp3/shared'
import { doormanUrl } from './doormanUrl'
import { appAddress } from './shareLink'

/**
 * Where a share link points: the doorman's own address, which a chat app can
 * read a card from and which sends a person on to the app
 * (apps/doorman/src/linkPage.ts). GitHub Pages cannot: it answers a link's
 * address with a 404. A development server's links stay on it, so they open
 * where they were made.
 */
export function linkAddress(): string {
  const app = appAddress()
  return app === DEFAULT_APP_URL ? doormanUrl : app
}
