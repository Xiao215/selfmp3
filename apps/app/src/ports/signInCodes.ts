import {
  DEEP_LINK_SCHEME,
  driveBackFromUrl,
  signInCodeFromUrl,
  signInRefusalFromUrl,
  type DriveBack,
  type SignInRefusal,
} from '@selfmp3/shared'

/**
 * Links coming back to the app from a trip to Google, and the inbox they
 * wait in.
 *
 * Google's sign-in ends with the doorman sending the browser back to where the
 * sign-in started — `selfmp3://welcome` in an installed app, this site's own
 * `/welcome` in a browser — with the code that claims the session in the
 * fragment. Nobody reads or types that code: it comes back inside the link,
 * and this is where the link lands. A sign-in Google did not finish — Cancel,
 * or an account the owner has not added — comes back the same way, with why
 * in place of the code.
 *
 * Connecting Google Drive is the same trip made by someone already signed in
 * (apps/doorman/src/driveConnect.ts), and ends the same way at
 * `selfmp3://storage`, saying only how it went: nothing is claimed.
 *
 * The inbox keeps a link that arrives before its screen is listening, which a
 * cold launch from a sign-in always is, and hands each code over once.
 */

/**
 * Where a trip to Google can come back to: Welcome, from signing in, and Where
 * it lives, from connecting Google Drive (`features/welcome/StorageScreen`).
 * The owner's admin page signs in on its own (`apps/server/admin/admin.js`),
 * not through the app.
 */
export type SignInTarget = 'welcome' | 'storage'

/** What a sign-in came back with: the code that claims it, or why there is none. */
export type SignInBack =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'refused'; readonly refusal: SignInRefusal }

/** What comes back to each target: a sign-in's code or refusal, or how connecting Drive went. */
export interface BackTo {
  readonly welcome: SignInBack
  readonly storage: DriveBack
}

type SignInLink = {
  readonly [Target in SignInTarget]: { readonly target: Target; readonly back: BackTo[Target] }
}[SignInTarget]

/**
 * The target and what came back in a returning link, or null for any other link.
 *
 * The target is the address's last path segment, so `selfmp3://welcome#…`
 * and `https://example.github.io/selfmp3/welcome#…` are the same return. Each
 * target reads only its own fragment: a sign-in's code means nothing to Where
 * it lives.
 */
export function signInLink(url: string): SignInLink | null {
  const path = url
    .replace(/[?#].*$/, '')
    .replace(new RegExp(`^${DEEP_LINK_SCHEME}://`), '/')
    .replace(/\/+$/, '')
  const last = path.slice(path.lastIndexOf('/') + 1)
  if (last === 'storage') {
    const back = driveBackFromUrl(url)
    return back ? { target: 'storage', back } : null
  }
  if (last !== 'welcome') return null
  const code = signInCodeFromUrl(url)
  const refusal = code === null ? signInRefusalFromUrl(url) : null
  const back: SignInBack | null =
    code !== null ? { kind: 'code', code } : refusal ? { kind: 'refused', refusal } : null
  return back ? { target: 'welcome', back } : null
}

interface SignInInbox {
  /** A link arrived. Anything that is not a return from Google is left alone; says whether it was one. */
  arrive(url: string): boolean
  /** What came back to `target`: any that arrived before, then each as it comes. */
  listen<Target extends SignInTarget>(
    target: Target,
    listener: (back: BackTo[Target]) => void,
  ): () => void
}

export function createSignInInbox(): SignInInbox {
  const waiting: SignInLink[] = []
  const listeners: { [Target in SignInTarget]: Set<(back: BackTo[Target]) => void> } = {
    welcome: new Set(),
    storage: new Set(),
  }
  /*
   * A code is handed over once. The same link can arrive twice — a phone
   * reports the link that launched the app and then delivers it as an event —
   * and a second claim with a spent code is refused, which would read as a
   * failed sign-in on one that worked. A refusal spends nothing, and the
   * same one may well come back twice on purpose: it is handed over each time.
   * So is how connecting Drive went, which only ever makes the page ask again.
   */
  const seen = new Set<string>()

  const hand = (link: SignInLink): boolean => {
    if (link.target === 'welcome') {
      if (listeners.welcome.size === 0) return false
      for (const listener of listeners.welcome) listener(link.back)
      return true
    }
    if (listeners.storage.size === 0) return false
    for (const listener of listeners.storage) listener(link.back)
    return true
  }

  return {
    arrive(url) {
      const link = signInLink(url)
      if (!link) return false
      if (link.target === 'welcome' && link.back.kind === 'code') {
        if (seen.has(link.back.code)) return true
        seen.add(link.back.code)
      }
      if (!hand(link)) waiting.push(link)
      return true
    },

    listen(target, listener) {
      listeners[target].add(listener)
      for (let index = 0; index < waiting.length;) {
        const link = waiting[index]
        if (link?.target === target) {
          waiting.splice(index, 1)
          hand(link)
        } else {
          index += 1
        }
      }
      return () => {
        listeners[target].delete(listener)
      }
    },
  }
}
