import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The phone's download storage, over a fake of the expo-file-system classes it
 * uses (the same shape `recentCopies.test.ts` fakes).
 *
 * One thing pinned: `delete` settles once the file is gone and rejects when
 * the system would not let it go. The port used to type it `void`, so a throw
 * from `File.delete()` was a stray exception out of the queue's `remove` —
 * and the queue had already written the index without the song.
 */

/** Path → size in bytes. */
const disk = new Map<string, number>()
/** Paths the system refuses to unlink. */
const locked = new Set<string>()

class FakeDirectory {
  readonly uri: string
  constructor(parent: string | FakeDirectory, name: string) {
    this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`
  }
  get exists(): boolean {
    return [...disk.keys()].some(path => path.startsWith(`${this.uri}/`)) || disk.has(this.uri)
  }
  create(): void {
    disk.set(this.uri, 0)
  }
  delete(): void {
    for (const path of [...disk.keys()])
      if (path === this.uri || path.startsWith(`${this.uri}/`)) disk.delete(path)
  }
}

class FakeFile {
  readonly uri: string
  constructor(parent: FakeDirectory, name: string) {
    this.uri = `${parent.uri}/${name}`
  }
  get exists(): boolean {
    return disk.has(this.uri)
  }
  delete(): void {
    if (locked.has(this.uri)) throw new Error('EPERM: operation not permitted')
    disk.delete(this.uri)
  }
}

vi.mock('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { cache: 'file:///cache', document: 'file:///document' },
}))
vi.mock('../api/client', () => ({
  api: {},
  mediaUrlFor: () => ({ stream: () => '', art: () => '' }),
}))
vi.mock('./recentCopies', () => ({ adoptRecent: async () => null }))
vi.mock('./songSource', () => ({ sourceFor: async () => ({ url: '' }) }))
vi.mock('../offline/covers', () => ({
  ensureServerCover: async () => undefined,
  KEPT_COVER_SIZE: 0,
}))
vi.mock('../offline/lyricsCache', () => ({ writeCachedLyrics: () => undefined }))
vi.mock('../offline/motionCache', () => ({ writeCachedMotion: () => undefined }))

const entry = {
  songId: 7,
  fileName: '7.m4a',
  sizeBytes: 4096,
  etag: '',
  rev: 'r7',
  downloadedAt: '2026-09-14T00:00:00.000Z',
}
const PATH = 'file:///document/songs/7.m4a'

describe('the phone download storage', () => {
  beforeEach(() => {
    disk.clear()
    locked.clear()
    disk.set(PATH, 4096)
  })

  it('settles once a kept file is gone, and rejects when the system keeps it', async () => {
    const { downloadStorage } = await import('./downloadStorage')

    locked.add(PATH)
    await expect(downloadStorage.delete(entry)).rejects.toThrow('EPERM')
    expect(disk.has(PATH)).toBe(true)

    locked.delete(PATH)
    await expect(downloadStorage.delete(entry)).resolves.toBeUndefined()
    expect(disk.has(PATH)).toBe(false)

    // Nothing there is nothing to fail at.
    await expect(downloadStorage.delete(entry)).resolves.toBeUndefined()
  })
})
