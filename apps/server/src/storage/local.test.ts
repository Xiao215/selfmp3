import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageDriver } from './local.js'

/**
 * The library folder, against a real one. A symlink inside it can point
 * anywhere on the disk, and whatever the folder lists is indexed, streamed and
 * uploaded to the bucket, so a link counts only when it stays inside.
 */
describe('LocalStorageDriver', () => {
  let base: string
  let root: string
  let storage: LocalStorageDriver

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-local-'))
    root = path.join(base, 'library')
    storage = new LocalStorageDriver(root)
    fs.mkdirSync(path.join(root, 'in'))
    fs.writeFileSync(path.join(root, 'in', 'real.mp3'), 'audio')
    fs.writeFileSync(path.join(base, 'secret.txt'), 'root:x:0:0')
    fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'in', 'passwd.mp3'))
    fs.symlinkSync(path.join(root, 'in', 'real.mp3'), path.join(root, 'in', 'alias.mp3'))
    fs.mkdirSync(path.join(base, 'elsewhere'))
    fs.symlinkSync(path.join(base, 'elsewhere'), path.join(root, 'out'))
  })

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('lists files and links that stay inside, and not a link that leaves', async () => {
    expect(await storage.list()).toEqual(['in/alias.mp3', 'in/real.mp3'])
  })

  it('refuses to read, stat or stream through a link that leaves', async () => {
    expect(await storage.exists('in/passwd.mp3')).toBe(false)
    expect(await storage.stat('in/passwd.mp3')).toBeNull()
    await expect(storage.read('in/passwd.mp3')).rejects.toThrow(/escapes/)
    await expect(storage.rangeSource('in/passwd.mp3', 'audio/mpeg')).rejects.toThrow(/escapes/)
    expect(() => storage.localPath('in/passwd.mp3')).toThrow(/escapes/)
  })

  it('refuses to write through a folder that links outside', async () => {
    await expect(storage.write('out/new.mp3', Buffer.from('x'))).rejects.toThrow(/escapes/)
    expect(fs.readdirSync(path.join(base, 'elsewhere'))).toEqual([])
  })

  it('still reads and writes inside, including new folders', async () => {
    expect((await storage.read('in/alias.mp3')).toString()).toBe('audio')
    await storage.write('new/folder/song.mp3', Buffer.from('fresh'))
    expect((await storage.read('new/folder/song.mp3')).toString()).toBe('fresh')
  })
})
