import type { DesktopBridge } from '@selfmp3/desktop-bridge'

/**
 * A phone is never the desktop — the native half of the port pair, and the one
 * Metro resolves for iOS and Android.
 *
 * It exists rather than letting `bridge.web.ts` answer for everyone because
 * React Native defines a `window` stub: the guard there would run, and every
 * phone bundle would carry the contract package to be told `null`.
 */
export const desktop: DesktopBridge | null = null

export type { DesktopBridge }
