import { desktopRecentCopies } from './desktop/recentCopies.desktop'
import type { RecentCopies } from './recentCopyFiles'

type PlayedCopies = Pick<
  RecentCopies<unknown>,
  | 'recentIds'
  | 'recentUri'
  | 'promoteRecent'
  | 'forgetRecent'
  | 'clearRecent'
  | 'keepRecentlyPlayed'
  | 'dropAhead'
>

/**
 * Songs kept because they were played: none, in a browser tab. A tab streams
 * and keeps nothing, played or not — only an installed app keeps songs
 * (`DownloadsProvider`'s `keepable`), and the installed desktop app keeps its
 * copies through the shell (`recentCopies.desktop.ts`), its `app://` page
 * having no Cache API. So a tab answers that nothing is kept, and a kept copy
 * never has an address of its own.
 */
const browserRecentCopies: PlayedCopies = {
  recentIds: () => new Set(),
  recentUri: () => null,
  promoteRecent: () => undefined,
  forgetRecent: () => undefined,
  clearRecent: () => undefined,
  keepRecentlyPlayed: () => Promise.resolve(),
  dropAhead: () => undefined,
}

const chosen: PlayedCopies = desktopRecentCopies ?? browserRecentCopies

export const recentIds = chosen.recentIds
export const recentUri = chosen.recentUri
export const promoteRecent = chosen.promoteRecent
export const forgetRecent = chosen.forgetRecent
export const clearRecent = chosen.clearRecent
export const keepRecentlyPlayed = chosen.keepRecentlyPlayed
export const dropAhead = chosen.dropAhead
