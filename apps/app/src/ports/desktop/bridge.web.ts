import { BRIDGE_GLOBAL, type DesktopBridge } from '@selfmp3/desktop-bridge'

/**
 * The one place in the app that reads `window.selfmp3Desktop`.
 *
 * `desktop` is `null` in a browser and on a phone, and the shell's bridge in the
 * installed app. Every port that behaves differently on the desktop asks this
 * and nothing else; no feature imports this file, which the lint rule below the
 * ports directory enforces.
 *
 * It is typed by `@selfmp3/desktop-bridge` — the same package `apps/desktop`
 * implements — so a channel that changes shape in the shell is a compile error
 * here rather than an `undefined` at runtime.
 *
 * The guard is deliberately shallow: the preload either exposed the object or
 * it did not, and half a bridge is not a case that can happen (a
 * `contextBridge` call is all or nothing). What *can* happen is this file being
 * bundled for the phone, where there is no `window` at all.
 */
const found =
  typeof window === 'undefined'
    ? null
    : ((window as unknown as Record<string, unknown>)[BRIDGE_GLOBAL] as DesktopBridge | undefined) ??
      null

export const desktop: DesktopBridge | null = found

export type { DesktopBridge }
