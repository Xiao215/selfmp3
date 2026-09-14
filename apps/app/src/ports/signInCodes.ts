import { SignInCodeSchema } from '@selfmp3/shared'

/**
 * Sign-in links coming back to the app, and the inbox they wait in.
 *
 * Google's sign-in ends with the doorman sending the browser back to where the
 * sign-in started — `selfmp3://sign-in` or `selfmp3://settings` in an installed
 * app, this site's own `/sign-in` or `/settings` in a browser — with the code
 * that claims the session in the fragment. Nobody reads or types that code: it
 * comes back inside the link, and this is where the link lands.
 *
 * Two targets rather than one, so a code meant for Settings (the server
 * signing in) is never spent by the first-run screen, or the other way round.
 * The inbox keeps a link that arrives before its screen is listening, which a
 * cold launch from a sign-in always is, and hands each code over once.
 */

/** Where a sign-in can come back to: the first-run screen, or Settings → Cloud. */
export type SignInTarget = 'sign-in' | 'settings'

export interface SignInLink {
  readonly target: SignInTarget
  readonly code: string
}

const CODE = /(?:^|[#&?])signin-code=([0-9A-Za-z-]{1,32})/

/**
 * The target and code in a returning link, or null for any other link.
 *
 * The target is the address's last path segment, so `selfmp3://settings#…`
 * and `https://example.github.io/selfmp3/settings#…` are the same return.
 */
export function signInLink(url: string): SignInLink | null {
  const raw = CODE.exec(url)?.[1]
  if (raw === undefined) return null
  const code = SignInCodeSchema.safeParse(raw)
  if (!code.success) return null
  const path = url
    .replace(/[?#].*$/, '')
    .replace(/^selfmp3:\/\//, '/')
    .replace(/\/+$/, '')
  const last = path.slice(path.lastIndexOf('/') + 1)
  return last === 'sign-in' || last === 'settings' ? { target: last, code: code.data } : null
}

export interface SignInInbox {
  /** A link arrived. Anything that is not a sign-in return is left alone; says whether it was one. */
  arrive(url: string): boolean
  /** Codes for `target`: any that arrived before, then each as it comes. */
  listen(target: SignInTarget, listener: (code: string) => void): () => void
}

export function createSignInInbox(): SignInInbox {
  const waiting: SignInLink[] = []
  const listeners: Record<SignInTarget, Set<(code: string) => void>> = {
    'sign-in': new Set(),
    settings: new Set(),
  }
  /*
   * A code is handed over once. The same link can arrive twice — a phone
   * reports the link that launched the app and then delivers it as an event —
   * and a second claim with a spent code is refused, which would read as a
   * failed sign-in on one that worked.
   */
  const seen = new Set<string>()

  return {
    arrive(url) {
      const link = signInLink(url)
      if (!link) return false
      if (seen.has(link.code)) return true
      seen.add(link.code)
      const here = listeners[link.target]
      if (here.size === 0) waiting.push(link)
      else for (const listener of here) listener(link.code)
      return true
    },

    listen(target, listener) {
      listeners[target].add(listener)
      for (let index = 0; index < waiting.length; ) {
        const link = waiting[index]
        if (link?.target === target) {
          waiting.splice(index, 1)
          listener(link.code)
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
