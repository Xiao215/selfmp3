import type { LoginItem } from './loginItem'
import { desktop } from './desktop/bridge'
import { NOT_INSTALLED } from './notInstalled'

function through(bridge: NonNullable<typeof desktop>): LoginItem {
  return {
    available: true,
    get: () => bridge.loginItem.get(),
    set: open => bridge.loginItem.set(open),
  }
}

/** See `loginItem.ts`. A tab cannot be a login item; the installed app can. */
export const loginItem: LoginItem = desktop ? through(desktop) : NOT_INSTALLED.loginItem
