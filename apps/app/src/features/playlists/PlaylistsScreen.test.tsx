import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, queryKeys, type Api } from '@selfmp3/client'
import type { Library, Playlist, PlaylistSongs, Song } from '@selfmp3/shared'

import { DownloadsProvider } from '../../offline/DownloadsProvider'
import { PlayerProvider } from '../../player/PlayerProvider'
import { OverlayProvider } from '../../shell/Overlay'
import { PlaylistsScreen } from './PlaylistsScreen'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  usePathname: () => '/playlists',
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: unknown }) => children,
}))

// Not a cloud library: nothing shared to list, no share link or room offered.
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false, status: 'ready' }),
}))

jest.mock('../../ports/install', () => ({ installedApp: false }))

// A phone: the tile's menu comes from a hold.
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, compact: true, dense: false, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutFlags: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

jest.mock('../../ports/engine', () => {
  const state = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    stalled: false,
    error: null,
  }
  const noop = (): undefined => undefined
  return {
    createEngine: () => ({
      capabilities: { analyser: false, crossfade: false },
      state,
      currentSongId: null,
      playhead: 0,
      subscribe: () => noop,
      configure: noop,
      load: async () => undefined,
      play: async () => undefined,
      pause: noop,
      seek: noop,
      setVolume: noop,
      setMuted: noop,
      analyser: () => null,
      destroy: noop,
      connect: () => noop,
      onTrackEnd: null,
      nextTrackId: null,
      streamUrl: null,
      streamHeaders: null,
      trackMetadata: null,
      onProgress: null,
    }),
  }
})

const deletePlaylist = jest.fn<Promise<void>, [number]>(async () => undefined)
const createPlaylist = jest.fn()
configureClient({
  api: {
    deletePlaylist,
    createPlaylist,
    gems: async () => ({ songs: [], minDays: 30 }),
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => false,
  } as unknown as Api,
})

function song(id: number): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    path: `songs/${id}.mp3`,
    mime: 'audio/mpeg',
    sizeBytes: 1000,
    rev: 1,
    loved: false,
    tagIds: [],
    playCount: 0,
    lastPlayedAt: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    coverTone: null,
    audioFeatures: null,
    hasArt: false,
  } as unknown as Song
}

const evening = {
  id: 7,
  name: 'Evening',
  description: '',
  kind: 'manual',
  rules: null,
  songCount: 2,
  totalDuration: 400,
  lastPlayedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Playlist

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

async function renderScreen(): Promise<void> {
  const client = new QueryClient({
    // No collection timers, a mutation's included, to hold the run open after the last test.
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  })
  client.setQueryData(queryKeys.library, {
    songs: [song(1), song(2)],
    tags: [],
    playlists: [evening],
    version: 1,
  } as unknown as Library)
  client.setQueryData(queryKeys.playlistSongs(evening.id), {
    songIds: [1, 2],
  } as unknown as PlaylistSongs)
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <DownloadsProvider>
          <PlayerProvider>
            <OverlayProvider>
              <PlaylistsScreen />
            </OverlayProvider>
          </PlayerProvider>
        </DownloadsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

async function holdTile(): Promise<void> {
  await act(async () => {
    await fireEvent(screen.getByTestId('playlist-row-0'), 'longPress')
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

beforeEach(() => {
  mockPush.mockClear()
  deletePlaylist.mockClear()
})

describe('a playlist tile’s menu', () => {
  it('offers what the playlist page’s ⋯ does, but Select songs', async () => {
    await renderScreen()
    await holdTile()
    for (const label of [
      'Play next',
      'Add to Up next',
      'Rename',
      'Add a description',
      'Duplicate',
      'Delete playlist…',
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.queryByText('Select songs')).toBeNull()
  })

  it('takes Rename to the playlist’s page, with the name ready to type over', async () => {
    await renderScreen()
    await holdTile()
    await act(async () => {
      await fireEvent.press(screen.getByText('Rename'))
    })
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/playlists/[id]',
      params: { id: '7', rename: '1' },
    })
  })

  it('asks before deleting, then deletes', async () => {
    await renderScreen()
    await holdTile()
    await act(async () => {
      await fireEvent.press(screen.getByText('Delete playlist…'))
    })
    expect(screen.getByText('Delete this playlist?')).toBeTruthy()
    expect(within(screen.getByTestId('confirm-dialog')).getByText('Evening')).toBeTruthy()
    await act(async () => {
      await fireEvent.press(screen.getByText('Delete'))
    })
    expect(deletePlaylist).toHaveBeenCalledWith(7)
  })
})
