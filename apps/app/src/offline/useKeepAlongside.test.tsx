import { act, renderHook } from '@testing-library/react-native'
import type { Library, Playlist, Song } from '@selfmp3/shared'

import { useKeepAlongside } from './useKeepAlongside'

/*
 * What a cloud library keeps beside its songs: every cover and every artist's
 * picture, asked for again a while later when the bucket would not give one
 * (its daily cap), and — only once every one is here — the pictures the
 * library no longer names swept away.
 */

const COVER = `covers/${'a'.repeat(64)}.jpg`
const BANNER = `covers/${'b'.repeat(64)}.jpg`
const PORTRAIT = `covers/${'c'.repeat(64)}.jpg`

const library: Library = {
  songs: [{ id: 1, rev: 'r1', hasArt: true } as Song],
  tags: [],
  playlists: [],
  version: 1,
  generatedAt: '2026-10-07T00:00:00Z',
}

let mockLibrary = library

const mockEnsureCover = jest.fn<Promise<string | null>, [number]>()
const mockPlaylistSongs = jest.fn<Promise<{ playlistId: number; songIds: number[] }>, [number]>()
const mockEnsurePicture = jest.fn<Promise<string | null>, [string]>()
const mockSweep = jest.fn<Promise<number>, [ReadonlySet<string>]>()

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: mockLibrary, isError: false, dataUpdatedAt: 1 }),
  isDownloaded: () => false,
}))
jest.mock('../api/client', () => ({
  api: { playlistSongs: (id: number) => mockPlaylistSongs(id) },
  mediaUrlFor: () => ({}),
}))
jest.mock('../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: true }),
}))
jest.mock('./DownloadsProvider', () => ({
  useDownloads: () => ({ state: { index: {} }, installed: true }),
}))
jest.mock('./lyricsCache', () => ({}))
jest.mock('./motionCache', () => ({}))
jest.mock('./playlistCache', () => ({ writeCachedPlaylist: () => undefined }))
jest.mock('../replica', () => ({
  library: {
    cloudPicturesNow: () => ({
      covers: new Set([`covers/${'a'.repeat(64)}.jpg`]),
      artists: [
        { banner: `covers/${'b'.repeat(64)}.jpg`, portrait: `covers/${'c'.repeat(64)}.jpg` },
      ],
    }),
  },
}))
jest.mock('./covers', () => ({
  KEPT_COVER_SIZE: 640,
  ensureCover: (songId: number) => mockEnsureCover(songId),
  ensurePicture: (key: string) => mockEnsurePicture(key),
  ensureServerCover: () => Promise.resolve(),
  sweepPictures: (named: ReadonlySet<string>) => mockSweep(named),
}))

/** Lets the pass's chain of awaits run out. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await act(async () => Promise.resolve())
}

describe('useKeepAlongside, for a cloud library', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockLibrary = library
    mockPlaylistSongs.mockReset().mockImplementation(async id => ({ playlistId: id, songIds: [1] }))
    mockEnsureCover.mockReset().mockResolvedValue('file:///cover.jpg')
    mockEnsurePicture.mockReset().mockResolvedValue('file:///picture.jpg')
    mockSweep.mockReset().mockResolvedValue(0)
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps every artist’s picture, then sweeps what the library no longer names', async () => {
    await renderHook(() => useKeepAlongside())
    await settle()

    expect(mockEnsureCover).toHaveBeenCalledWith(1)
    expect(mockEnsurePicture.mock.calls.map(([key]) => key).sort()).toEqual([BANNER, PORTRAIT])
    expect(mockSweep).toHaveBeenCalledTimes(1)
    expect([...(mockSweep.mock.calls[0]?.[0] ?? [])].sort()).toEqual([COVER, BANNER, PORTRAIT])
  })

  it('sweeps nothing while a picture is missing, and asks again ten minutes later', async () => {
    mockEnsurePicture.mockResolvedValueOnce(null)
    await renderHook(() => useKeepAlongside())
    await settle()

    expect(mockSweep).not.toHaveBeenCalled()
    expect(mockEnsurePicture).toHaveBeenCalledTimes(2)

    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000)
    })
    await settle()

    expect(mockEnsurePicture).toHaveBeenCalledTimes(4)
    expect(mockSweep).toHaveBeenCalledTimes(1)
  })

  it('keeps a playlist that changed without going over every song again', async () => {
    const live = { id: 5, songCount: 1, updatedAt: '2026-10-07 00:00:00' } as Playlist
    mockLibrary = { ...library, playlists: [live] }
    const { rerender } = await renderHook(() => useKeepAlongside())
    await settle()
    expect(mockEnsureCover).toHaveBeenCalledTimes(1)
    expect(mockPlaylistSongs).toHaveBeenCalledTimes(1)

    // A tag ticked that the live playlist follows: its count moves, no song's files do.
    mockLibrary = { ...library, playlists: [{ ...live, songCount: 2 }] }
    await rerender({})
    await settle()

    expect(mockPlaylistSongs).toHaveBeenCalledTimes(2)
    expect(mockEnsureCover).toHaveBeenCalledTimes(1)
  })

  it('lets the phone draw between songs rather than holding it for the whole pass', async () => {
    mockLibrary = {
      ...library,
      songs: [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id, rev: 'r1', hasArt: true }) as Song),
    }
    // Each cover is already here, answered at once — and takes a while to look for.
    mockEnsureCover.mockImplementation(async () => {
      jest.setSystemTime(Date.now() + 10)
      return 'file:///cover.jpg'
    })
    await renderHook(() => useKeepAlongside())
    await settle()
    // The four songs begun at once, and then a wait for the next turn.
    expect(mockEnsureCover).toHaveBeenCalledTimes(4)

    for (let turn = 0; turn < 4; turn++) {
      await act(async () => {
        jest.runOnlyPendingTimers()
      })
      await settle()
    }
    expect(mockEnsureCover).toHaveBeenCalledTimes(8)
  })
})
