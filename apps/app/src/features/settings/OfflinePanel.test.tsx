import { fireEvent, render, screen } from '@testing-library/react-native'
import type { Library, Song, SyncManifest } from '@selfmp3/shared'

import { OfflinePanel } from './OfflinePanel'

/**
 * The numbers in Settings → On this phone, and the buttons that delete things.
 *
 * Two findings from a real iPhone live here. The counts read the index where
 * they should have read the library, so two songs removed from a library of 45
 * left "43 of 43 songs downloaded" behind them — the panel counting rows that
 * were no longer anywhere. And "Remove all downloads" stayed live for the whole
 * time it was removing, so it could be pressed again, and again, over an index
 * the first press was still rewriting.
 */

let mockLibrary: { data: Library | undefined }
let mockManifest: { data: SyncManifest | undefined }
let mockDownloads: Record<string, unknown>

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => mockLibrary,
  useManifest: () => mockManifest,
}))
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => mockDownloads,
  useDownloadProgress: () => ({ activeSongId: null, bytesWritten: 0, totalBytes: 0 }),
}))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ fromCloud: true }),
}))
// A phone has no folder to show and nothing that can answer about the disk, so
// the panel falls back to the index — which is the case under test.
jest.mock('../../ports/downloadsFolder', () => ({
  downloadsFolder: {
    path: null,
    reveal: () => Promise.resolve(),
    usage: () => Promise.resolve(null),
  },
}))

const song = (id: number): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: '',
    path: `audio/${id}.m4a`,
    sizeBytes: 1000,
    durationSec: 200,
    loved: false,
    hasArt: false,
    tagIds: [],
    playCount: 0,
  }) as unknown as Song

const library = (ids: readonly number[]): Library =>
  ({ songs: ids.map(song), playlists: [], tags: [] }) as unknown as Library

const index = (ids: readonly number[]) => ({
  version: 1 as const,
  entries: Object.fromEntries(
    ids.map(id => [
      String(id),
      {
        songId: id,
        fileName: `${id}.m4a`,
        sizeBytes: 1000,
        etag: `etag-${id}`,
        downloadedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  ),
})

function downloads(
  held: readonly number[] = [],
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: {
      index: index(held),
      queue: [],
      activeSongId: null,
      bytesWritten: 0,
      totalBytes: 0,
      paused: false,
      error: null,
    },
    queue: { pause: jest.fn(), resume: jest.fn(), cancelAll: jest.fn(), remove: jest.fn() },
    prefs: { autoOnWifi: false, streamUndownloaded: true },
    setPrefs: jest.fn(),
    absentIds: [],
    absentBytes: 0,
    requestDownload: jest.fn(),
    removeFiles: jest.fn(() => Promise.resolve()),
    removing: false,
    ...patch,
  }
}

const draw = () =>
  render(<OfflinePanel title="On this phone" anchor={() => undefined} onConfirm={jest.fn()} />)

describe('On this phone counts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockManifest = { data: undefined }
  })

  it('counts what is here against the library that is here', async () => {
    // 45 songs, 43 of them downloaded: the state before anything is removed.
    const all = Array.from({ length: 45 }, (_, at) => at + 1)
    mockLibrary = { data: library(all) }
    mockDownloads = downloads(all.slice(0, 43))
    await draw()

    expect(screen.getByText('43')).toBeTruthy()
    expect(screen.getByText('of 45 songs downloaded')).toBeTruthy()
  })

  /*
   * Two songs removed here: the rows leave the library and, on a phone, the
   * downloads leave with them. Both numbers drop, and they drop together.
   */
  it('drops both numbers when a song is removed from the library', async () => {
    const all = Array.from({ length: 45 }, (_, at) => at + 1)
    const left = all.filter(id => id !== 7 && id !== 8)
    mockLibrary = { data: library(left) }
    mockDownloads = downloads(all.slice(0, 43).filter(id => id !== 7 && id !== 8))
    await draw()

    expect(screen.getByText('41')).toBeTruthy()
    expect(screen.getByText('of 43 songs downloaded')).toBeTruthy()
  })

  /*
   * The same removal made on another device. Nothing here deleted the files, so
   * the index still holds them — and the count still has to fall, because the
   * question is how much of *this* library is here. This is exactly what the
   * old code got wrong, in the direction that made it read "43 of 43".
   */
  it('stops counting a song removed elsewhere before its file is cleared', async () => {
    const all = Array.from({ length: 45 }, (_, at) => at + 1)
    mockLibrary = { data: library(all.filter(id => id !== 7 && id !== 8)) }
    mockDownloads = downloads(all.slice(0, 43))
    await draw()

    expect(screen.getByText('41')).toBeTruthy()
    expect(screen.getByText('of 43 songs downloaded')).toBeTruthy()
    expect(screen.queryByText('43')).toBeNull()
  })

  it('offers to remove everything the device keeps, library or not', async () => {
    // Nothing of this library is downloaded; two files from an older one are.
    mockLibrary = { data: library([1, 2]) }
    mockDownloads = downloads([90, 91])
    await draw()

    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove all downloads' })).toBeTruthy()
  })
})

describe('the buttons that delete things', () => {
  const stale: SyncManifest = { version: 1, songCount: 1, totalBytes: 1000, entries: [] }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLibrary = { data: library([1, 2]) }
    mockManifest = { data: stale }
  })

  it('says it is removing, and refuses a second press, while a removal runs', async () => {
    const onConfirm = jest.fn()
    // Nothing leftover, so "Remove all downloads" is the only button here.
    mockManifest = { data: undefined }
    mockDownloads = downloads([1, 2], { removing: true })
    await render(
      <OfflinePanel title="On this phone" anchor={() => undefined} onConfirm={onConfirm} />,
    )

    const button = screen.getByRole('button', { name: 'Removing…' })
    expect(button).toBeDisabled()
    await fireEvent.press(button)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables the leftovers button too, so the two cannot overlap', async () => {
    const removeFiles = jest.fn(() => Promise.resolve())
    mockDownloads = downloads([1, 2, 90], { removing: true, removeFiles })
    await draw()

    // Both buttons are the same "Removing…" now; neither may fire.
    for (const button of screen.getAllByRole('button', { name: 'Removing…' })) {
      expect(button).toBeDisabled()
      await fireEvent.press(button)
    }
    expect(removeFiles).not.toHaveBeenCalled()
  })

  it('asks the provider to clear the leftovers when it is idle', async () => {
    const removeFiles = jest.fn(() => Promise.resolve())
    mockDownloads = downloads([1, 2, 90], { removeFiles })
    await draw()

    await fireEvent.press(screen.getByRole('button', { name: 'Remove leftover files' }))
    expect(removeFiles).toHaveBeenCalledWith([1, 2, 90])
  })
})
