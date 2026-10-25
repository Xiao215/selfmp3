import type { IosUpdatePort } from './iosUpdate'

/** A browser updates with the page; there is no build to install. */
export const iosUpdate: IosUpdatePort = {
  offered: false,
  build: Number.NaN,
  latest: () => Promise.resolve(null),
  install: () => Promise.resolve(),
}
