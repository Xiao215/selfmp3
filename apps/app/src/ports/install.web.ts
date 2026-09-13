/**
 * Whether this is an installed app, which keeps songs, or a browser, which
 * streams.
 *
 * In a browser, a tab. The desktop app is the same web build inside Electron,
 * and it will say so by putting `selfmp3Desktop` on the window before the app
 * loads; then this is an installed app too, and downloads by default.
 */
export const installedApp =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { selfmp3Desktop?: unknown }).selfmp3Desktop)
