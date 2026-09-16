import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The cover policy on a phone, over a fake of the expo-file-system classes it
 * uses. What differs from the web twin, and is pinned here: priming reads the
 * kept covers synchronously, so the *first* `coversNow()` already has them —
 * that is what stops the flicker on every launch — and forgetting removes both
 * folders, the cache and the document store, along with what memory held.
 */

const disk = new Set<string>()

class FakeDirectory {
  readonly uri: string
  constructor(parent: string, name: string) {
    this.uri = `${parent}/${name}`
  }
  get exists(): boolean {
    return disk.has(this.uri)
  }
  create(): void {
    disk.add(this.uri)
  }
  delete(): void {
    for (const path of [...disk]) if (path === this.uri || path.startsWith(`${this.uri}/`)) disk.delete(path)
  }
  list(): FakeFile[] {
    return [...disk]
      .filter(path => path.startsWith(`${this.uri}/`) && path.endsWith('.jpg'))
      .map(path => new FakeFile(this, path.slice(this.uri.length + 1)))
  }
}

class FakeFile {
  readonly uri: string
  readonly name: string
  constructor(parent: FakeDirectory, name: string) {
    this.uri = `${parent.uri}/${name}`
    this.name = name
  }
  get exists(): boolean {
    return disk.has(this.uri)
  }
  static downloadFileAsync = vi.fn(async (_url: string, file: FakeFile) => {
    disk.add(file.uri)
    return file
  })
}

vi.mock('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { cache: 'file:///cache', document: 'file:///document' },
}))
vi.mock('../replica', () => ({
  library: { cloudCoverKey: async (songId: number) => `covers/hash-${songId}.jpg` },
  cloudPlatform: { doormanUrl: 'https://doorman.example' },
  session: { loadSession: async () => ({ token: 't' }) },
}))

async function covers() {
  return import('./covers')
}

describe('covers on a phone', () => {
  beforeEach(() => {
    vi.resetModules()
    disk.clear()
    FakeFile.downloadFileAsync.mockClear()
  })

  it("has a server's kept covers on the very first read, before any row asks", async () => {
    disk.add('file:///document/covers')
    disk.add('file:///document/covers/12-r1.jpg')
    const { coversNow } = await covers()
    expect(coversNow().get(12)).toBe('file:///document/covers/12-r1.jpg')
  })

  it('fetches a cloud cover once for however many rows ask at the same time', async () => {
    const { ensureCover } = await covers()
    const uris = await Promise.all([ensureCover(7), ensureCover(7)])
    expect(uris).toEqual(Array(2).fill('file:///cache/covers/hash-7.jpg'))
    expect(FakeFile.downloadFileAsync).toHaveBeenCalledTimes(1)
    expect(FakeFile.downloadFileAsync.mock.calls[0]?.[0]).toBe('https://doorman.example/v1/files/covers/hash-7.jpg')
  })

  it('forgets everything at sign-out: memory and both folders', async () => {
    disk.add('file:///document/covers')
    disk.add('file:///document/covers/12-r1.jpg')
    const { coversNow, coverFor, ensureCover, forgetCovers } = await covers()
    await ensureCover(7)
    expect(coversNow().size).toBe(2)

    await forgetCovers()

    expect(coversNow().size).toBe(0)
    expect(coverFor(7)).toBeUndefined()
    expect(disk.size).toBe(0)
    // Another account's song 7 is fetched afresh, not answered from memory.
    await ensureCover(7)
    expect(FakeFile.downloadFileAsync).toHaveBeenCalledTimes(2)
  })
})
