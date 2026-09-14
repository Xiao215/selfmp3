import { createRequire } from 'node:module'

/**
 * Where this machine's Electron binary is.
 *
 * Not a path spelled out here: `node_modules/electron/dist/electron` is the
 * *Linux* name, and on a Mac the binary is
 * `dist/Electron.app/Contents/MacOS/Electron`. The electron package writes the
 * per-platform relative path into `path.txt` at install time and its `index.js`
 * joins that onto `dist/`, so requiring the package — whose main export is that
 * resolved string — is the one answer that is right on every platform, and
 * stays right if the package changes where it puts things.
 */
export function electronBinary() {
  return createRequire(import.meta.url)('electron')
}
