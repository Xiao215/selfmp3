import { desktop } from './desktop/bridge'

/**
 * Whether this is an installed app, which keeps songs, or a browser, which
 * streams.
 *
 * In a browser, a tab. The desktop app is the same web build inside Electron,
 * whose shell puts its bridge on the window before the app loads
 * (`desktop/bridge.web.ts`); then this is an installed app too, and downloads
 * by default.
 */
export const installedApp = desktop !== null
