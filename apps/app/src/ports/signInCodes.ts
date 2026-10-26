import {
  DEEP_LINK_SCHEME,
  signInCodeFromUrl,
  signInRefusalFromUrl,
  type SignInRefusal,
} from '@selfmp3/shared'

/**
 * Sign-in links coming back to the app, and the inbox they wait in.
 *
 * Google's sign-in ends with the doorman sending the browser back to where the
 * sign-in started — `selfmp3://welcome` in an installed app, this site's own
 * `/welcome` in a browser — with the code that claims the session in the
 * fragment. Nobody reads or types that code: it comes back inside the link,
 * and this is where the link lands. A sign-in Google did not finish — Cancel,
 * or an account the owner has not added — comes back the same way, with why
 * in place of the code.
 *
 * The inbox keeps a link that arrives before its screen is listening, which a
 * cold launch from a sign-in always is, and hands each code over once.
 */

/**
 * Where a sign-in can come back to: Welcome. The owner's admin page signs in
 * on its own (`apps/server/admin/admin.js`), not through the app.
 */
export type SignInTarget = 'welcome'

/** What a sign-in came back with: the code that claims it, or why there is none. */
export type SignInBack =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'refused'; readonly refusal: SignInRefusal }

interface SignInLink {
  readonly target: SignInTarget
  readonly back: SignInBack
}

/**
 * The target and what came back in a returning link, or null for any other link.
 *
 * The target is the address's last path segment, so `selfmp3://welcome#…`
 * and `https://example.github.io/selfmp3/welcome#…` are the same return.
 */
export function signInLink(url: string): SignInLink | null {
  const code = signInCodeFromUrl(url)
  const refusal = code === null ? signInRefusalFromUrl(url) : null
  const back: SignInBack | null =
    code !== null ? { kind: 'code', code } : refusal ? { kind: 'refused', refusal } : null
  if (back === null) return null
  const path = url
    .replace(/[?#].*$/, '')
    .replace(new RegExp(`^${DEEP_LINK_SCHEME}://`), '/')
    .replace(/\/+$/, '')
  const last = path.slice(path.lastIndexOf('/') + 1)
  return last === 'welcome' ? { target: last, back } : null
}

interface SignInInbox {
  /** A link arrived. Anything that is not a sign-in return is left alone; says whether it was one. */
  arrive(url: string): boolean
  /** What came back to `target`: any that arrived before, then each as it comes. */
  listen(target: SignInTarget, listener: (back: SignInBack) => void): () => void
}

export function createSignInInbox(): SignInInbox {
  const waiting: SignInLink[] = []
  const listeners: Record<SignInTarget, Set<(back: SignInBack) => void>> = {
    welcome: new Set(),
  }
  /*
   * A code is handed over once. The same link can arrive twice — a phone
   * reports the link that launched the app and then delivers it as an event —
   * and a second claim with a spent code is refused, which would read as a
   * failed sign-in on one that worked. A refusal spends nothing, and the
   * same one may well come back twice on purpose: it is handed over each time.
   */
  const seen = new Set<string>()

  return {
    arrive(url) {
      const link = signInLink(url)
      if (!link) return false
      if (link.back.kind === 'code') {
        if (seen.has(link.back.code)) return true
        seen.add(link.back.code)
      }
      const here = listeners[link.target]
      if (here.size === 0) waiting.push(link)
      else for (const listener of here) listener(link.back)
      return true
    },

    listen(target, listener) {
      listeners[target].add(listener)
      for (let index = 0; index < waiting.length;) {
        const link = waiting[index]
        if (link?.target === target) {
          waiting.splice(index, 1)
          listener(link.back)
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
