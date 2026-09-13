/**
 * An address inside this app, under the base it was built for.
 *
 * `/` when the Mac serves the web build, `/selfmp3` on GitHub Pages. Expo
 * inlines `process.env.EXPO_BASE_URL` from `experiments.baseUrl` with any
 * trailing slash trimmed, and leaves it empty for a build with no base, and on
 * a phone, where nothing is served from a path at all.
 */
const BASE = process.env.EXPO_BASE_URL ?? ''

export function appPath(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`
}
