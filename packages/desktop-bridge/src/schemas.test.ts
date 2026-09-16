import { describe, expect, it } from 'vitest'

import { externalUrlSchema, fileNameSchema, fileTextSchema } from './schemas.js'

/*
 * These two rules are why the shell has the shape it does, and each was learned
 * the hard way on `desktop/phase-5`, so they are written down as tests rather
 * than left to a regex read in passing.
 */

describe('fileNameSchema', () => {
  it('takes the names the app writes', () => {
    for (const name of ['1.m4a', 'downloads.json', "12-a1b2 (Xiao's mix).jpg"]) {
      expect(fileNameSchema.safeParse(name).success).toBe(true)
    }
  })

  /*
   * The reason `files.list` filters rather than returning the directory: the
   * preload parses the whole listing against this schema, and macOS drops a
   * `.DS_Store` beside the songs the first time "Reveal in Finder" opens them.
   * One of those makes every listing throw, for good.
   */
  it('refuses what something other than the app left in the directory', () => {
    for (const name of ['.DS_Store', '._1.m4a', '.hidden']) {
      expect(fileNameSchema.safeParse(name).success).toBe(false)
    }
  })

  it('still refuses a name that is really a path', () => {
    for (const name of ['../secrets.json', 'songs/1.m4a', '..']) {
      expect(fileNameSchema.safeParse(name).success).toBe(false)
    }
  })
})

describe('externalUrlSchema', () => {
  /*
   * The reason the page cannot save its download index through `fetchTo`: this
   * refuses a `blob:` URL — and widening it would not have helped, because the
   * fetch happens in the main process, where a renderer's blob URL does not
   * resolve at all. `files.write` is the channel for the page's own text.
   */
  it('admits only what the main process can actually go and get', () => {
    expect(externalUrlSchema.safeParse('https://example.com/a.jpg').success).toBe(true)
    expect(externalUrlSchema.safeParse('http://10.0.0.2:4600/api/stream/1').success).toBe(true)
    expect(externalUrlSchema.safeParse('blob:app://selfmp3/8f7e-…').success).toBe(false)
    expect(externalUrlSchema.safeParse('file:///etc/passwd').success).toBe(false)
  })
})

describe('fileTextSchema', () => {
  it('takes an index and refuses a disk-filling one', () => {
    expect(fileTextSchema.safeParse(JSON.stringify({ version: 1, entries: [] })).success).toBe(true)
    expect(fileTextSchema.safeParse('x'.repeat(1024 * 1024 + 1)).success).toBe(false)
  })
})
