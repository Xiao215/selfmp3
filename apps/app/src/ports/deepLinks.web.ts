import type { DeepLinkRoute } from './deepLinks'
import { desktop } from './desktop/bridge'

export type { DeepLinkRoute }

/**
 * `selfmp3://` links, sorted into the two things they can be: somewhere to go,
 * and a sign-in coming back.
 *
 * One queue per kind, rather than one queue read by whoever asks first: the
 * sign-in poller used to `shift()` the only queue there was, so a
 * `selfmp3://now-playing` arriving while Settings was waiting for a sign-in was
 * taken by the poller and thrown away.
 *
 * Both queues keep what arrived before anything was listening. A cold launch
 * from a link — which is every sign-in return, and most of the others — puts
 * the link in the shell's hands before the page has finished loading. This is
 * the bridge's only listener; sign-in links are passed on whole, and
 * `ports/signInReturn` decides which screen each one is for.
 */

const SIGN_IN = /(?:^|[#&])signin-code=/

const signIns: string[] = []
const signInListeners = new Set<(url: string) => void>()
const pending: DeepLinkRoute[] = []
const listeners = new Set<(route: DeepLinkRoute) => void>()

/** `selfmp3://playlist/12` → the playlist; `selfmp3://now-playing` → the stage. */
export function routeFor(url: string): DeepLinkRoute | null {
  const match = /^selfmp3:\/\/([A-Za-z-]+)(?:\/([^?#]*))?/.exec(url)
  if (!match) return null
  const [, host, rest] = match
  if (host === 'now-playing') return { kind: 'now-playing' }
  if (host === 'playlist') {
    const id = decodeURIComponent(rest ?? '').replace(/\/$/, '')
    // A playlist id is a number in this app. Anything else is a link from
    // somewhere that guessed, and going nowhere is better than a broken screen.
    return /^\d+$/.test(id) ? { kind: 'playlist', id } : null
  }
  return null
}

function arrived(url: string): void {
  if (SIGN_IN.test(url)) {
    if (signInListeners.size === 0) signIns.push(url)
    else for (const listener of signInListeners) listener(url)
    return
  }
  const route = routeFor(url)
  if (!route) return
  if (listeners.size === 0) {
    pending.push(route)
    return
  }
  for (const listener of listeners) listener(route)
}

if (desktop) desktop.onDeepLink(arrived)

export function onSignInLink(listener: (url: string) => void): () => void {
  signInListeners.add(listener)
  while (signIns.length > 0) {
    const url = signIns.shift()
    if (url !== undefined) listener(url)
  }
  return () => {
    signInListeners.delete(listener)
  }
}

export function onDeepLinkRoute(listener: (route: DeepLinkRoute) => void): () => void {
  listeners.add(listener)
  // Whatever came in before the app was ready to go anywhere.
  while (pending.length > 0) {
    const route = pending.shift()
    if (route) listener(route)
  }
  return () => {
    listeners.delete(listener)
  }
}
