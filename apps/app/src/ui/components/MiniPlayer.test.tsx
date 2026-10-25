import { act, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { MiniPlayer } from './MiniPlayer'

/*
 * The player, as the card reads it: the song loaded and where it sits in the
 * queue, in a store the card re-renders from as the real provider's context
 * would. The engine behind it is a native module a test does not have.
 */
type MockPlaying = { current: Song | null; index: number }
let mockPlaying: MockPlaying = { current: null, index: 0 }
const mockListeners = new Set<() => void>()
function play(next: MockPlaying): void {
  mockPlaying = next
  for (const listener of mockListeners) listener()
}
jest.mock('../../player/PlayerProvider', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react')
  const subscribe = (listener: () => void): (() => void) => {
    mockListeners.add(listener)
    return () => mockListeners.delete(listener)
  }
  return {
    usePlayer: () => {
      const { current, index } = useSyncExternalStore(subscribe, () => mockPlaying)
      return {
        current,
        // Up next's button counts what waits after the song; nothing does here.
        queue: { items: [], original: [], index, shuffle: false, repeat: 'off' },
        isPlaying: true,
        toggle: () => undefined,
        next: () => undefined,
      }
    },
    usePlayerCommands: () => ({ toggle: () => undefined }),
    usePlayerPlaying: () => true,
    usePlayingSongId: () => mockPlaying.current?.id ?? null,
    usePlayerProgress: () => ({ position: 0, duration: 200 }),
    usePlayerStalled: () => false,
  }
})
jest.mock('../../offline/useArt', () => ({ useArt: () => () => null }))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: () => undefined }) }))

const song = (id: number, title: string): Song =>
  ({ id, title, artist: `Artist ${id}`, album: '', duration: 200 }) as unknown as Song

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const card = (
  <SafeAreaProvider initialMetrics={METRICS}>
    <MiniPlayer />
  </SafeAreaProvider>
)

jest.useFakeTimers()

describe('MiniPlayer', () => {
  it('steps the song that was playing out as the next one steps in', async () => {
    play({ current: song(1, 'First light'), index: 0 })
    await render(card)
    expect(screen.getByText('First light')).toBeTruthy()

    await act(async () => play({ current: song(2, 'Second wind'), index: 1 }))

    // The arriving words, and the leaving ones over them: the old song's.
    expect(screen.getByText('Second wind')).toBeTruthy()
    expect(screen.getByText('First light', { includeHiddenElements: true })).toBeTruthy()
  })

  it('keeps the last song on the card while it sinks away, then goes', async () => {
    play({ current: song(1, 'First light'), index: 0 })
    await render(card)

    await act(async () => play({ current: null, index: 0 }))
    expect(screen.getByText('First light')).toBeTruthy()

    await act(async () => {
      jest.runAllTimers()
    })
    expect(screen.queryByTestId('mini-player')).toBeNull()
  })
})
