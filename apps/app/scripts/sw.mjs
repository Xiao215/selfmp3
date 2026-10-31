import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

/**
 * public/sw.js: the service worker, bundled from sw/sw.ts with this build's
 * stamp (`__SHELL_BUILD__`, which names its shell cache).
 *
 * A script rather than an esbuild command line because the stamp was the
 * shell's `$(date +%s)`, and npm runs scripts with cmd.exe on Windows, which
 * passed it through as those very characters: every build from there named
 * its cache `selfmp3-shell-$(date +%s)`, and none swept away the last.
 */
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stamp = String(Math.floor(Date.now() / 1000))

await build({
  entryPoints: [resolve(app, 'sw/sw.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: { __SHELL_BUILD__: JSON.stringify(stamp) },
  outfile: resolve(app, 'public/sw.js'),
  logLevel: 'info',
})
