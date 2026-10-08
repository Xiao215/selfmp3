import { act, renderHook } from '@testing-library/react-native'
import type { Library, Song } from '@selfmp3/shared'

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

const mockEnsureCover = jest.fn<Promise<string | null>, [number]>()
const mockEnsurePicture = jest.fn<Promise<string | null>, [string]>()
const mockSweep = jest.fn<Promise<number>, [ReadonlySet<string>]>()

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: library, isError: false, dataUpdatedAt: 1 }),
  isDownloaded: () => false,
}))
jest.mock('../api/client', () => ({ api: {}, mediaUrlFor: () => ({}) }))
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
})
