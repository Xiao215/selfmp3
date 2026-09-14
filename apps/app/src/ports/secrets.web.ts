import type { SecretStore } from './secrets'
import { desktop } from './desktop/bridge'

export type { SecretStore }

/**
 * The installed app's answer: the keychain, through the bridge.
 *
 * This is one of the four reasons the desktop app exists at all. A token in
 * `localStorage` is protected by the origin and nothing else; one in
 * `safeStorage` is sealed with a key in the login keychain and kept in
 * `userData/secrets.json`. The plan's rule is absolute — tokens go through
 * `desktop.secrets` and nowhere else — so this branch is not a nicety.
 *
 * Where a machine has no keychain behind `safeStorage` (a Linux session with no
 * secret service) the shell keeps them plainly and says so in `info`, which
 * Settings reads. That is exactly the promise the browser makes, so it is never
 * a reason to refuse to sign in.
 */
const keychain: SecretStore = {
  get: key => desktop?.secrets.get(key) ?? Promise.resolve(null),
  set: (key, value) => desktop?.secrets.set(key, value) ?? Promise.resolve(),
  remove: key => desktop?.secrets.remove(key) ?? Promise.resolve(),
}

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
const browserStore: SecretStore = {
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

export const secrets: SecretStore = desktop ? keychain : browserStore
