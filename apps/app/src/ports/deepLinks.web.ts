import type { DeepLinkRoute } from './deepLinks'
import { desktop } from './desktop/bridge'

export type { DeepLinkRoute }

/**
 * `selfmp3://` links, sorted into the two things they can be.
 *
 * One queue per kind, rather than one queue read by whoever asks first: the
 * sign-in poller used to `shift()` the only queue there was, so a
 * `selfmp3://now-playing` arriving while Settings was waiting for a code was
 * taken by the poller and thrown away.
 *
 * Both queues keep what arrived before anything was listening. A cold launch
 * from a link — which is every sign-in return, and most of the others — puts
 * the link in the shell's hands before the page has finished loading.
 */

const CODE = /(?:^|[#&])signin-code=([0-9A-Za-z-]{1,32})/

const codes: string[] = []
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
  const code = CODE.exec(url)?.[1]
  if (code !== undefined) {
    codes.push(code)
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

export function takeSignInCode(): string | null {
  return codes.shift() ?? null
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
