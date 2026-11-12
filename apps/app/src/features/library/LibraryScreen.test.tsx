import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, queryKeys, type Api } from '@selfmp3/client'
import type { Library, Song } from '@selfmp3/shared'

import { DownloadsProvider } from '../../offline/DownloadsProvider'
import { PlayerProvider } from '../../player/PlayerProvider'
import { OverlayProvider } from '../../shell/Overlay'
import { LibraryFilterProvider } from './libraryFilter'
import { LibraryScreen } from './LibraryScreen'

jest.mock('expo-router', () => ({
  usePathname: () => '/library',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
  Link: ({ children }: { children: unknown }) => children,
}))

jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: true, status: 'ready' }),
}))

// An installed phone with none of the library on it yet: "On this phone" is offered.
jest.mock('../../ports/install', () => ({ installedApp: true }))

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

configureClient({
  api: {
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => true,
  } as unknown as Api,
})

function song(id: number): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    loved: false,
    tagIds: [1],
    playCount: 0,
    lastPlayedAt: null,
    restUntil: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    coverTone: null,
    audioFeatures: null,
  } as unknown as Song
}

const LIBRARY = {
  songs: [song(1), song(2), song(3)],
  tags: [{ id: 1, name: 'chill', hue: 200, songCount: 3 }],
  playlists: [],
  version: 1,
} as unknown as Library

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

describe('Library with nothing matching', () => {
  it('shows every song again from "Show all songs", on this phone or not', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } },
    })
    client.setQueryData(queryKeys.library, LIBRARY)
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <DownloadsProvider>
            <PlayerProvider>
              <LibraryFilterProvider>
                <OverlayProvider>
                  <LibraryScreen />
                </OverlayProvider>
              </LibraryFilterProvider>
            </PlayerProvider>
          </DownloadsProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    )
    // A tag, and only the songs on this phone: none are.
    await fireEvent.press(screen.getAllByText('chill')[0]!)
    await fireEvent.press(screen.getByTestId('library-on-this-phone'))
    expect(screen.getByText('Nothing matches these tags')).toBeTruthy()

    await fireEvent.press(screen.getByText('Show all songs'))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(screen.queryByTestId('library-no-matches')).toBeNull()
  })
})
