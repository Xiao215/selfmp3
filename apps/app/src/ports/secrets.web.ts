import type { SecretStore } from './secrets'

export type { SecretStore }

/**
 * The browser's answer: `localStorage`, which is what the web app already uses
 * for the small things it has to remember (`apps/web/src/lib/device.ts` keeps
 * the device id and name there).
 *
 * A browser has no keychain to put this in. That is a real difference in what
 * the platform can promise, not a shortcut: on the web the token is protected
 * by the origin and nothing else, exactly as every other credential a web app
 * holds is. It is the same trade the web app makes today.
 *
 * Every call is wrapped, because `localStorage` is not merely empty in a
 * private window or with site data blocked — the accessor itself throws, and an
 * app that cannot remember its server should still start.
 */
export const secrets: SecretStore = {
  get: key => {
    try {
      return Promise.resolve(window.localStorage.getItem(key))
    } catch {
      return Promise.resolve(null)
    }
  },
  set: (key, value) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Nothing to do: the app works, it just forgets.
    }
    return Promise.resolve()
  },
  remove: key => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // As above.
    }
    return Promise.resolve()
  },
}
