import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FORMAT_KEY } from '@selfmp3/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalCloudStore } from './local.js'
import { CloudError } from './store.js'

/**
 * A folder standing in for the bucket that goes away — its drive unplugged,
 * the folder moved — is a bucket that is not there, not an empty one to fill
 * again (R3-m10).
 */
describe('LocalCloudStore', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  const bucket = (): { root: string; store: LocalCloudStore } => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-folder-'))
    roots.push(parent)
    const root = path.join(parent, 'bucket')
    return { root, store: new LocalCloudStore(root) }
  }
  const json = { contentType: 'application/json' }
  const audio = { contentType: 'audio/mp4' }

  it('is made by its format.json, and then takes files', async () => {
    const { store } = bucket()
    await store.put(FORMAT_KEY, Buffer.from('{}'), json)
    await store.put('audio/a.m4a', Buffer.from('aaa'), audio)
    expect(await store.head('audio/a.m4a')).toEqual({ key: 'audio/a.m4a', size: 3 })
    expect((await store.list('audio/')).map(object => object.key)).toEqual(['audio/a.m4a'])
  })

  it('refuses a file once the folder has gone, and does not make it again', async () => {
    const { root, store } = bucket()
    await store.put(FORMAT_KEY, Buffer.from('{}'), json)
    fs.rmSync(root, { recursive: true })

    const put = store.put('audio/b.m4a', Buffer.from('bbb'), audio)
    await expect(put).rejects.toBeInstanceOf(CloudError)
    await expect(put).rejects.toMatchObject({ kind: 'missing' })
    expect(fs.existsSync(root)).toBe(false)
    // Nor says it holds nothing: that is not known.
    await expect(store.list('audio/')).rejects.toMatchObject({ kind: 'missing' })
  })

  it('refuses a file in a folder that is not a bucket', async () => {
    const { root, store } = bucket()
    fs.mkdirSync(root)
    await expect(store.put('audio/c.m4a', Buffer.from('c'), audio)).rejects.toMatchObject({
      kind: 'missing',
    })
  })
})
