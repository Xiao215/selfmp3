import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { QueueState, Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { closeQueueSheet, isQueueSheetOpen, openQueueSheet } from './queueSheet.store'
import { QueueRail } from './QueueRail'

/**
 * Up next on a computer (T-379): built apart from the phone's sheet, it had
 * no Clear the rest, no "Played" end for a song played on its own, and
 * stayed asked for with nothing in it. It now draws the sheet's list.
 */

const song = (id: number): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Klara Feld',
    album: '',
    duration: 240,
    tagIds: [],
  }) as unknown as Song

/*
 * The player, as Up next reads it: the queue and its songs, in a store the
 * rail re-renders from as the real provider's context would. The engine
 * behind it is a native module a test does not have.
 */
interface MockPlayer {
  current: Song | null
  queue: QueueState
  ranOut: boolean
}
let mockPlayer: MockPlayer
const mockListeners = new Set<() => void>()
function mockSet(next: MockPlayer): void {
  mockPlayer = next
  for (const listener of mockListeners) listener()
}
const mockClearRest = jest.fn()
jest.mock('../../player/PlayerProvider', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react')
  const subscribe = (listener: () => void): (() => void) => {
    mockListeners.add(listener)
    return () => mockListeners.delete(listener)
  }
  const commands = {
    toggle: () => undefined,
    jumpTo: () => undefined,
    playFrom: () => undefined,
    playShuffled: () => undefined,
    reorderQueue: () => undefined,
    insertIntoQueue: () => undefined,
    clearRest: () => {
      mockClearRest()
      return mockPlayer.queue
    },
    restoreRest: () => undefined,
    setAutoMix: () => undefined,
  }
  const usePlayer = () => {
    const now = useSyncExternalStore(subscribe, () => mockPlayer)
    return {
      ...commands,
      ...now,
      songs: now.queue.items.map(id => ({ id, title: `Song ${id}`, duration: 240, tagIds: [] })),
      source: null,
      isPlaying: !now.ranOut,
      autoMix: false,
      canCrossfade: true,
      nextCrossfadeSeconds: 4,
    }
  }
  return {
    usePlayer,
    usePlayerCommands: () => commands,
    usePlayerPlaying: () => !mockPlayer.ranOut,
    usePlayingSongId: () => mockPlayer.current?.id ?? null,
    usePlayerStalled: () => false,
    usePlayerProgress: () => ({ position: 30, duration: 240 }),
  }
})
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    state: { index: { version: 1, entries: {} } },
    installed: false,
    streamBlocked: false,
  }),
}))
jest.mock('../../offline/useArt', () => ({ useArt: () => () => null }))
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: () => undefined, push: () => undefined }),
}))
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: { songs: [], playlists: [], tags: [] } }),
  useCreatePlaylist: () => ({ mutateAsync: jest.fn() }),
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: true, dense: true, compact: false, finePointer: true, width: 1400 }
  return {
    useLayout: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 1400, height: 900, scale: 2, fontScale: 1 }),
  }
})

const queue = (items: number[], index: number): QueueState =>
  ({ items, original: items, index, shuffle: false, repeat: 'off' }) as unknown as QueueState

const METRICS = {
  frame: { x: 0, y: 0, width: 1400, height: 900 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <OverlayProvider>
          <QueueRail />
        </OverlayProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  )

describe('the Up next rail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openQueueSheet()
  })
  afterEach(() => closeQueueSheet())

  it('clears the rest, as the phone’s sheet does, and lists what played', async () => {
    mockSet({ current: song(2), queue: queue([1, 2, 3], 1), ranOut: false })
    await draw()

    expect(screen.getByRole('button', { name: 'Playing Song 2. Open now playing' })).toBeTruthy()
    expect(screen.getByText('Next · 1 song · 4 min')).toBeTruthy()
    expect(screen.getByText('Played')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('queue-clear-rest'))
    expect(mockClearRest).toHaveBeenCalled()
  })

  it('says a song played on its own has been played, and offers what could come next', async () => {
    mockSet({ current: song(2), queue: queue([2], 0), ranOut: true })
    await draw()

    expect(screen.getByRole('button', { name: 'Played Song 2. Open now playing' })).toBeTruthy()
    expect(screen.getByText('That was the only song')).toBeTruthy()
    expect(screen.getByTestId('queue-clear-rest')).toBeDisabled()
  })

  it('puts itself away when nothing is left, rather than coming back with the next song', async () => {
    mockSet({ current: song(2), queue: queue([2], 0), ranOut: false })
    await draw()
    expect(isQueueSheetOpen()).toBe(true)

    await act(async () => mockSet({ current: null, queue: queue([], 0), ranOut: false }))
    expect(isQueueSheetOpen()).toBe(false)
  })
})
