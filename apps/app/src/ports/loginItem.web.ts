import type { LoginItem } from './loginItem'
import { desktop } from './desktop/bridge'

export type { LoginItem }

function through(bridge: NonNullable<typeof desktop>): LoginItem {
  return {
    available: true,
    get: () => bridge.loginItem.get(),
    set: open => bridge.loginItem.set(open),
  }
}

/** See `loginItem.ts`. A tab cannot be a login item; the installed app can. */
export const loginItem: LoginItem = desktop
  ? through(desktop)
  : { available: false, get: () => Promise.resolve(false), set: () => Promise.resolve(false) }
