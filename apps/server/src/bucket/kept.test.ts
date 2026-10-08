import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { KeptCloudFiles } from './kept.js'

/** The bucket's small files on this disk: named by their hash, so never stale. */
describe('KeptCloudFiles', () => {
  const KEY = `lyrics/${'ab'.repeat(32)}.lrc`
  let dir: string
  let kept: KeptCloudFiles

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-kept-'))
    kept = new KeptCloudFiles(dir, createLogger('silent'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a file under its key, and lets it go', async () => {
    expect(await kept.read(KEY)).toBeNull()
    await kept.keep(KEY, Buffer.from('[00:01.00] la'))
    expect((await kept.read(KEY))?.toString()).toBe('[00:01.00] la')
    expect(fs.readdirSync(path.join(dir, 'lyrics'))).toEqual([KEY.slice('lyrics/'.length)])
    await kept.forget(KEY)
    expect(await kept.read(KEY)).toBeNull()
    await expect(kept.forget(KEY)).resolves.toBeUndefined()
  })

  it('keeps nothing but files named by their hash, and nothing outside its folder', async () => {
    for (const key of [
      'snapshots/20260911T100000000Z-mac-3f9a1c2e.json',
      'log/mac-3f9a1c2e/000000000001.json',
      `lyrics/../../${'ab'.repeat(32)}.lrc`,
      '../escape.txt',
    ]) {
      await kept.keep(key, Buffer.from('x'))
      expect(await kept.read(key)).toBeNull()
    }
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('is a miss, not a failure, when its folder cannot be written', async () => {
    const blocked = path.join(dir, 'file')
    fs.writeFileSync(blocked, '')
    const broken = new KeptCloudFiles(blocked, createLogger('silent'))
    await expect(broken.keep(KEY, Buffer.from('x'))).resolves.toBeUndefined()
    expect(await broken.read(KEY)).toBeNull()
  })
})
