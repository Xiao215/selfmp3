import type { DownloadsFolder } from './downloadsFolder'
import type { LoginItem } from './loginItem'
import type { UpdatesPort } from './updates'

/**
 * What a phone and an ordinary tab answer for the ports only the installed
 * desktop app can fill: no updates to install, no login item, no folder to
 * show. One copy, read by the base files and by the web twins when there is no
 * desktop bridge, rather than written out in each.
 *
 * Its own file because a web twin cannot take a value from its base: a
 * browser's bundle resolves `./updates` to `updates.web.ts` itself.
 */
export const NOT_INSTALLED: {
  readonly updates: UpdatesPort
  readonly loginItem: LoginItem
  readonly downloadsFolder: DownloadsFolder
} = {
  updates: {
    available: false,
    version: null,
    check: () =>
      Promise.resolve({
        state: 'idle',
        version: null,
        releaseUrl: null,
        canInstall: false,
        message: null,
      }),
    install: () => Promise.resolve(),
    on: () => () => {},
  },
  loginItem: {
    available: false,
    get: () => Promise.resolve(false),
    set: () => Promise.resolve(false),
  },
  downloadsFolder: {
    path: null,
    reveal: () => Promise.resolve(),
    usage: () => Promise.resolve(null),
  },
}
