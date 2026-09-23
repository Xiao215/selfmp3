import { act, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, queryKeys, type Api } from '@selfmp3/client'
import type { Library, Song } from '@selfmp3/shared'

import { DownloadsProvider, useDownloads } from '../../offline/DownloadsProvider'
import { PlayerProvider, usePlayer } from '../../player/PlayerProvider'
import { OverlayProvider } from '../../shell/Overlay'
import { LibraryFilterProvider } from './libraryFilter'
import { LibraryScreen } from './LibraryScreen'

jest.mock('expo-router', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: unknown }) => children,
}))

jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: true, status: 'ready' }),
}))

// A browser-like device: nothing downloads by itself, so the list holds still.
jest.mock('../../ports/install', () => ({ installedApp: false }))

jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, compact: true, dense: false, finePointer: false, width: 390 }),
}))

// Each render of a row, with the props that differ from its last render: the
// row is memoised, so a render is exactly a changed prop.
let mockRowRenders = 0
const mockChanged: string[][] = []
jest.mock('../../ui/components/SongRow', () => {
  const actual = jest.requireActual<typeof import('../../ui/components/SongRow')>(
    '../../ui/components/SongRow',
  )
  const React = jest.requireActual<typeof import('react')>('react')
  const last = new Map<number, Record<string, unknown>>()
  const Counted = React.memo(function CountedSongRow(props: Record<string, unknown>) {
    mockRowRenders++
    const id = (props['song'] as { id: number }).id
    const before = last.get(id)
    if (before) mockChanged.push(Object.keys(props).filter(key => props[key] !== before[key]))
    last.set(id, props)
    return React.createElement(actual.SongRow as never, props)
  })
  return { ...actual, SongRow: Counted }
})

jest.mock('../../ports/engine', () => {
  const state = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    rate: 1,
    stalled: false,
    error: null,
    loopA: null,
    loopB: null,
    countingIn: false,
    preservesPitch: true,
  }
  const noop = (): undefined => undefined
  return {
    createEngine: () => ({
      capabilities: { analyser: false, crossfade: false, loop: false },
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
      setRate: noop,
      setPreservesPitch: noop,
      setLoop: noop,
      clearLoop: noop,
      setCountIn: noop,
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

const setLoved = jest.fn<Promise<Song>, [number, boolean]>()
// The one client the hooks reach for: a like answers as the server would.
configureClient({
  api: {
    setLoved,
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
    path: `songs/${id}.mp3`,
    mime: 'audio/mpeg',
    sizeBytes: 1000,
    rev: 1,
    loved: false,
    tagIds: [1],
    playCount: 0,
    lastPlayedAt: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    coverTone: null,
    audioFeatures: null,
  } as unknown as Song
}

function library(count: number): Library {
  return {
    songs: Array.from({ length: count }, (_, i) => song(i + 1)),
    tags: [{ id: 1, name: 'chill', hue: 200, songCount: count }],
    playlists: [],
    version: 1,
  } as unknown as Library
}

/** Stands in for the mini player, the tab bar, the car provider: anything that reads the player. */
let playerReaders = 0
function PlayerReader(): null {
  usePlayer()
  playerReaders++
  return null
}
/** Stands in for the sync status, the offline panel: anything that reads downloads. */
let downloadsReaders = 0
function DownloadsReader(): null {
  useDownloads()
  downloadsReaders++
  return null
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/**
 * What a change to one song costs the rest of the app. A like once lingered
 * on a phone for as long as the JavaScript thread was busy after the tap, and
 * what kept it busy was a render of every row on screen and of everything that
 * reads the player or the downloads — for one song's `loved`. The heart has
 * left the row for the song's menu and page (`S3`), but a like still lands in
 * the library the same way, as one song changed.
 */
describe('a like, at phone width', () => {
  it('re-renders the row that was liked and nothing else', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } },
    })
    const lib = library(30)
    client.setQueryData(queryKeys.library, lib)
    setLoved.mockImplementation(async (id, loved) => ({
      ...lib.songs.find(candidate => candidate.id === id)!,
      loved,
    }))

    const { container } = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <DownloadsProvider>
            <PlayerProvider>
              <LibraryFilterProvider>
                <OverlayProvider>
                  <LibraryScreen />
                  <PlayerReader />
                  <DownloadsReader />
                </OverlayProvider>
              </LibraryFilterProvider>
            </PlayerProvider>
          </DownloadsProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    )
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    const rowsOnScreen = container.queryAll(node => node.props['role'] === 'row').length
    expect(rowsOnScreen).toBeGreaterThan(10)
    mockRowRenders = 0
    mockChanged.length = 0
    playerReaders = 0
    downloadsReaders = 0

    // What a like does to the library once the server has answered.
    await act(async () => {
      client.setQueryData(queryKeys.library, {
        ...lib,
        songs: lib.songs.map(song => (song.id === 3 ? { ...song, loved: true } : song)),
      })
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // The optimistic guess and the answer are the same song, so once.
    expect(mockRowRenders).toBe(1)
    expect(mockChanged).toEqual([['song', 'tags']])
    expect(playerReaders).toBe(0)
    expect(downloadsReaders).toBe(0)
  })
})
