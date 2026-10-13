import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { RecordStore } from './recordStore'

/*
 * The offline caches' rules, run over both stores: a phone's folder of files
 * (over a fake of expo-file-system) and a browser's IndexedDB keys (over a fake
 * of the IndexedDB port). What is pinned is where the eight copies this
 * replaced had drifted: a phone's read threw where its other calls did not, a
 * browser's clear could fail sign-out, and a record of an older shape was
 * counted as kept, so the catch-up pass never fetched it again.
 */

/** Path or key → what is there. */
const disk = new Map<string, string>()
let broken = false

class FakeDirectory {
  readonly uri: string
  constructor(parent: string, name: string) {
    this.uri = `${parent}/${name}`
  }
  get exists(): boolean {
    return [...disk.keys()].some(path => path.startsWith(`${this.uri}/`))
  }
  create(): void {}
  delete(): void {
    if (broken) throw new Error('EPERM')
    for (const path of [...disk.keys()]) if (path.startsWith(`${this.uri}/`)) disk.delete(path)
  }
}

class FakeFile {
  readonly uri: string
  constructor(parent: FakeDirectory, name: string) {
    this.uri = `${parent.uri}/${name}`
  }
  get exists(): boolean {
    if (broken) throw new Error('the file system is not answering')
    return disk.has(this.uri)
  }
  text(): Promise<string> {
    return Promise.resolve(disk.get(this.uri) ?? '')
  }
  write(text: string): void {
    disk.set(this.uri, text)
  }
  delete(): void {
    disk.delete(this.uri)
  }
}

vi.mock('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { document: 'file:///document' },
}))

let reads = 0
vi.mock('../ports/idbStore.web', () => ({
  readStored: async (key: string) => {
    reads += 1
    if (broken) throw new Error('IndexedDB read aborted')
    const text = disk.get(key)
    return text === undefined ? null : (JSON.parse(text) as unknown)
  },
  writeStored: async (key: string, value: unknown) => void disk.set(key, JSON.stringify(value)),
  deleteStored: async (key: string) => void disk.delete(key),
  deleteStoredPrefix: async (prefix: string) => {
    if (broken) throw new Error('IndexedDB delete aborted')
    for (const key of [...disk.keys()]) if (key.startsWith(prefix)) disk.delete(key)
  },
}))

const Words = z.object({ text: z.string() })

async function flush(): Promise<void> {
  // Writes are fire-and-forget.
  await new Promise(resolve => setTimeout(resolve, 0))
}

const stores: Record<string, () => Promise<(kind: string) => RecordStore>> = {
  phone: async () => (await import('./recordStore')).recordStore,
  browser: async () => (await import('./recordStore.web')).recordStore,
}

beforeEach(() => {
  disk.clear()
  broken = false
  reads = 0
})

describe.each(Object.keys(stores))('a cache over the %s store', name => {
  async function cache() {
    const store = await (stores[name] as () => Promise<(kind: string) => RecordStore>)()
    const { createSchemaCache } = await import('./schemaCache')
    return {
      words: createSchemaCache(store('lyrics'), Words),
      other: createSchemaCache(store('motion'), Words),
    }
  }

  it('reads back what it wrote', async () => {
    const { words } = await cache()
    words.write(12, { text: 'la la la' })
    await flush()

    expect(await words.has(12)).toBe(true)
    expect(await words.read(12)).toEqual({ text: 'la la la' })
    expect(await words.has(13)).toBe(false)
    expect(await words.read(13)).toBeNull()
  })

  it('lets go of a record it cannot use, so it is fetched again', async () => {
    const { words } = await cache()
    words.write(12, { text: 'la la la' })
    await flush()
    // Rewritten in an older shape, as an earlier version left it.
    for (const key of disk.keys()) disk.set(key, JSON.stringify({ words: 'la la la' }))
    const { words: afresh } = await cache()

    expect(await afresh.read(12)).toBeNull()
    expect(await afresh.has(12)).toBe(false)
    expect(disk.size).toBe(0)
  })

  it('answers nothing, rather than failing, when the store will not', async () => {
    const { words } = await cache()
    broken = true

    await expect(words.read(12)).resolves.toBeNull()
    await expect(words.has(12)).resolves.toBe(false)
    await expect(words.clear()).resolves.toBeUndefined()
  })

  it('clears every record of its kind and nothing else', async () => {
    const { words, other } = await cache()
    words.write(12, { text: 'la la la' })
    other.write(12, { text: 'kept' })
    await flush()

    await words.clear()

    expect(await words.has(12)).toBe(false)
    expect(await words.read(12)).toBeNull()
    expect(await other.read(12)).toEqual({ text: 'kept' })
  })
})

describe('a cache over the browser store', () => {
  it('knows what it has seen kept without reading it again', async () => {
    const store = (await import('./recordStore.web')).recordStore
    const { createSchemaCache } = await import('./schemaCache')
    const words = createSchemaCache(store('lyrics'), Words)
    words.write(12, { text: 'la la la' })
    await flush()
    reads = 0

    expect(await words.has(12)).toBe(true)
    expect(await words.has(12)).toBe(true)
    expect(reads).toBe(0)
  })
})
