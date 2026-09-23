import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { SongMenu } from './SongMenu'

/**
 * A song's ⋯ menu (docs/ui-mock `P14`): what is in it, where Song details goes,
 * and what "remove" means on the device it is open on.
 *
 * The owner's words: "delete from library means delete from local too". On a
 * phone that is one action behind one confirmation. The second question — keep
 * the file, or delete it — is about the *server's* library folder and stays on
 * the computer, where that folder is.
 *
 * "Remove download", which keeps the song and frees the room, is a separate
 * wish and has to survive both.
 */

// Song details and a tag chip go to pages; the real router needs an app round it.
const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }))

const mockDeleteSong = jest.fn()
const mockRemoveByHand = jest.fn(() => Promise.resolve())
const mockDropDownloads = jest.fn(() => Promise.resolve())
let mockIndex: { version: 1; entries: Record<string, unknown> }

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: { songs: [], playlists: [], tags: [] } }),
  useAddToPlaylist: () => ({ mutate: jest.fn() }),
  useRemoveFromPlaylist: () => ({ mutate: jest.fn() }),
  useDeleteSong: () => ({ mutate: mockDeleteSong }),
  useToggleLoved: () => ({ mutate: jest.fn() }),
  clientApi: () => ({ similar: () => Promise.resolve({ songs: [] }) }),
}))
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    state: { index: mockIndex },
    installed: true,
    downloadByHand: jest.fn(),
    removeByHand: mockRemoveByHand,
    dropDownloads: mockDropDownloads,
  }),
  useDownloadProgress: () => ({ activeSongId: null, bytesWritten: 0, totalBytes: 0 }),
}))
jest.mock('../../offline/useArt', () => ({ useArt: () => () => null }))
jest.mock('../../player/PlayerProvider', () => ({
  usePlayer: () => ({ playNext: jest.fn(), addToQueue: jest.fn(), playFrom: jest.fn() }),
}))
jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, dense: false, compact: true, finePointer: false, width: 390 }),
}))

const SONG = {
  id: 4,
  title: 'Nocturne',
  artist: 'Klara Feld',
  duration: 224,
  sizeBytes: 4_000_000,
  loved: false,
  tagIds: [],
} as unknown as Song

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const draw = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OverlayProvider>
        <SongMenu song={SONG} onClose={() => undefined} />
      </OverlayProvider>
    </SafeAreaProvider>,
  )

const downloaded = {
  version: 1 as const,
  entries: {
    '4': {
      songId: 4,
      fileName: '4.m4a',
      sizeBytes: 4_000_000,
      etag: 'etag-4',
      downloadedAt: '2026-01-01T00:00:00.000Z',
    },
  },
}

describe('what the menu offers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIndex = { version: 1, entries: {} }
  })

  it('names the song and leaves Play next and Select to other places', async () => {
    await draw()

    expect(screen.getByText('Nocturne')).toBeTruthy()
    expect(screen.getByText('Klara Feld · 3:44')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Like' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tags' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
    // From the start of the name: the › after Add to playlist is part of it.
    for (const kept of [/^Add to playlist/, /^Add to queue$/, /^Play similar songs$/]) {
      expect(screen.getByRole('menuitem', { name: kept })).toBeTruthy()
    }
    expect(screen.queryByRole('menuitem', { name: 'Play next' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Select' })).toBeNull()
  })

  it('opens the song’s own page from Song details', async () => {
    await draw()

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Song details' }))
    expect(mockNavigate).toHaveBeenCalledWith('/song/4')
  })
})

describe('removing a song where the copy goes with it', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIndex = downloaded
  })

  it('is one confirmed action that takes the download too', async () => {
    await draw()

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Remove from library…' }))
    // The sheet draws through the overlay host, so the confirmation lands a
    // tick later; `find` waits for it where `get` would read the menu as it was.
    const confirm = await screen.findByRole('menuitem', { name: 'Remove from library' })
    expect(screen.getByText(/The download on this device goes too/)).toBeTruthy()

    await fireEvent.press(confirm)
    expect(mockDropDownloads).toHaveBeenCalledWith([4])
    expect(mockDeleteSong).toHaveBeenCalledWith(4)
  })

  it('still offers dropping the download on its own', async () => {
    await draw()

    await fireEvent.press(screen.getByRole('button', { name: 'Remove download' }))
    expect(mockRemoveByHand).toHaveBeenCalledWith([4])
    expect(mockDeleteSong).not.toHaveBeenCalled()
  })

  it('does not promise a download that is not there', async () => {
    mockIndex = { version: 1, entries: {} }
    await draw()

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Remove from library…' }))
    await screen.findByRole('menuitem', { name: 'Remove from library' })
    expect(screen.queryByText(/The download on this device goes too/)).toBeNull()
  })
})
