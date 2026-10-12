import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The desktop app's played-song cache, over a fake of the shell's file channels
 * (the bridge is the boundary; everything on this side of it is real). Pinned:
 * a played cloud song is kept in its own folder and played from there, a copy
 * the folder no longer has is not offered, asking for the song by hand moves
 * the copy rather than fetching it again, and a capped bucket is not asked.
 */

/** `kind/name` → size in bytes. */
const disk = new Map<string, number>()
const stored = new Map<string, string>()
let held: { message: string } | null = null
let nextBytes = 4_000_000

const bridge = {
  files: {
    download: vi.fn(async (request: { kind: string; name: string }) => {
      disk.set(`${request.kind}/${request.name}`, nextBytes)
      return { state: 'done' as const, bytes: nextBytes }
    }),
    move: vi.fn(async (from: string, to: string, name: string) => {
      const bytes = disk.get(`${from}/${name}`)
      if (bytes === undefined) return null
      disk.delete(`${from}/${name}`)
      disk.set(`${to}/${name}`, bytes)
      return { name, bytes }
    }),
    delete: vi.fn(async (kind: string, name: string) => void disk.delete(`${kind}/${name}`)),
    list: vi.fn(async (kind: string) =>
      [...disk]
        .filter(([path]) => path.startsWith(`${kind}/`))
        .map(([path, bytes]) => ({ name: path.slice(kind.length + 1), bytes })),
    ),
    clear: vi.fn(async (kind: string) => {
      for (const path of [...disk.keys()]) if (path.startsWith(`${kind}/`)) disk.delete(path)
    }),
    usage: vi.fn(async () => ({ songs: 0, covers: 0, free: 100 * 1024 * 1024 * 1024 })),
  },
  mediaUrl: (kind: string, name: string) => `app://selfmp3/_media/${kind}/${name}`,
}

vi.mock('./bridge', () => ({
  get desktop() {
    return bridge
  },
}))
vi.mock('../prefs', () => ({
  prefs: {
    get: (key: string) => stored.get(key) ?? null,
    set: (key: string, value: string) => void stored.set(key, value),
  },
}))
vi.mock('../songSource', () => ({
  sourceFor: (song: { path: string }) =>
    Promise.resolve({
      url: `https://doorman.example/v1/files/${song.path}`,
      headers: { Authorization: 'Bearer t' },
    }),
}))
vi.mock('@selfmp3/replica', () => ({ bucketHold: () => held }))

const SHA = 'a'.repeat(64)
const song = { id: 7, path: `audio/${SHA}.m4a` }
const NAME = `${SHA}.m4a`

async function fresh(): Promise<typeof import('./recentCopies.desktop')> {
  vi.resetModules()
  return import('./recentCopies.desktop')
}

describe('songs kept because they were played, on the desktop', () => {
  beforeEach(() => {
    disk.clear()
    stored.clear()
    held = null
    nextBytes = 4_000_000
    for (const fn of Object.values(bridge.files)) fn.mockClear()
  })

  it('keeps a played song in its own folder and plays it from there', async () => {
    const { desktopRecentCopies: recent } = await fresh()

    await recent.keepRecentlyPlayed(song)

    expect(bridge.files.download).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'recent', name: NAME }),
    )
    expect(recent.recentIds()).toEqual(new Set([7]))
    expect(recent.recentUri(7)).toBe(`app://selfmp3/_media/recent/${NAME}`)
  })

  it('fetches a song played again from nowhere', async () => {
    const { desktopRecentCopies: recent } = await fresh()
    await recent.keepRecentlyPlayed(song)
    await recent.keepRecentlyPlayed(song)
    expect(bridge.files.download).toHaveBeenCalledTimes(1)
  })

  it('leaves the bucket alone while it is refusing for the day', async () => {
    const { desktopRecentCopies: recent } = await fresh()
    held = { message: 'past the day’s allowance' }

    await recent.keepRecentlyPlayed(song)

    expect(bridge.files.download).not.toHaveBeenCalled()
    expect(recent.recentUri(7)).toBeNull()
  })

  it('stops offering a copy the folder no longer has', async () => {
    const first = await fresh()
    await first.desktopRecentCopies.keepRecentlyPlayed(song)
    disk.clear()

    const { desktopRecentCopies: recent } = await fresh()
    recent.recentIds()
    await vi.waitFor(() => expect(recent.recentUri(7)).toBeNull())
  })

  it('turns the copy into a download by moving it, not fetching it again', async () => {
    const { desktopRecentCopies: recent, adoptRecent } = await fresh()
    await recent.keepRecentlyPlayed(song)

    expect(await adoptRecent(song)).toBe(4_000_000)

    expect(bridge.files.move).toHaveBeenCalledWith('recent', 'songs', NAME)
    expect(disk.has(`songs/${NAME}`)).toBe(true)
    expect(recent.recentIds()).toEqual(new Set())
    expect(await adoptRecent(song)).toBeNull()
  })

  it('lets the oldest go when the copies outgrow their share of the disk', async () => {
    const { desktopRecentCopies: recent } = await fresh()
    bridge.files.usage.mockResolvedValue({ songs: 0, covers: 0, free: 50_000_000 })
    nextBytes = 4_000_000
    for (let id = 1; id <= 6; id++) {
      await recent.keepRecentlyPlayed({ id, path: `audio/${String(id).repeat(64)}.m4a` })
    }
    const kept = recent.recentIds()
    expect(kept.size).toBeLessThan(6)
    expect(kept.has(6)).toBe(true)
    expect(kept.has(1)).toBe(false)
  })
})
