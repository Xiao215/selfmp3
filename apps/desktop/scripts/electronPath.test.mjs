import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { electronBinary } from './electronPath.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/*
 * Regression. `dev.mjs` and `verify/launch.ts` both used to name
 * `node_modules/electron/dist/electron`, which is the Linux binary, so
 * `npm run dev:desktop` and `npm run verify:desktop` died with ENOENT on a Mac
 * before either did anything. The electron package writes the per-platform
 * relative path into `path.txt` when it installs — `electron` on Linux,
 * `Electron.app/Contents/MacOS/Electron` on macOS — so that is what the
 * resolved binary must end with, whatever machine this runs on.
 */
describe('electronBinary', () => {
  it('ends with the relative path the electron package named for this platform', () => {
    const named = readFileSync(join(repoRoot, 'node_modules', 'electron', 'path.txt'), 'utf8').trim()

    expect(named).not.toBe('')
    expect(electronBinary().endsWith(named)).toBe(true)
  })

  it('names a binary that is actually there', () => {
    expect(existsSync(electronBinary())).toBe(true)
  })
})
