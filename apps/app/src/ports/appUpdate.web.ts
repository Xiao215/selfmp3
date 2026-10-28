import type { AppUpdatePort } from './appUpdate'

/** A browser updates with the page; there is no build to install. */
export const appUpdate: AppUpdatePort = {
  offered: false,
  build: Number.NaN,
  downloads: false,
  browser: 'your browser',
  latest: () => Promise.resolve(null),
  install: () => Promise.resolve(),
  leave: () => {},
}
