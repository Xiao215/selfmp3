import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shellFiles } from './shellFiles.mjs'

/**
 * dist/shell.json: the files of this export the service worker keeps when it
 * installs (shellFiles.mjs says which). Written after `expo export`, which
 * names the bundle after its contents, so the list is the export's own.
 */
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const all = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => relative(dist, resolve(entry.parentPath, entry.name)))
const files = shellFiles(all)
if (!files.some(file => file.startsWith('_expo/'))) {
  throw new Error(`no bundle under ${dist}/_expo: run expo export first`)
}
writeFileSync(resolve(dist, 'shell.json'), `${JSON.stringify(files)}\n`)
console.log(`wrote ${resolve(dist, 'shell.json')} (${files.length} files)`)
