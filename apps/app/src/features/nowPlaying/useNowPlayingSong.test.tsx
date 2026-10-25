import { Text } from 'react-native'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { useNowPlayingSong } from './useNowPlayingSong'

/**
 * Removing the song playing from Now Playing (T-378). On a computer the
 * dialog was the stage's own, and the stage went the moment the player let
 * the song go — before the server answered — so the "Deleted …" toast and any
 * error went with it and the page sat on "Nothing playing". Asked above the
 * page, the dialog outlives the song, and the page goes once it has closed.
 */

const mockPutAway = jest.fn()
jest.mock('./leaveNowPlaying', () => ({ putAway: () => mockPutAway() }))
jest.mock('expo-router', () => ({ useRouter: () => ({}) }))

/*
 * The player, as the page reads it: the song loaded, which `forgetSongs` lets
 * go of at once, as the real one does. The engine behind it is a native module
 * a test does not have.
 */
let mockCurrent: Song | null = null
const mockListeners = new Set<() => void>()
function mockLoad(song: Song | null): void {
  mockCurrent = song
  for (const listener of mockListeners) listener()
}
jest.mock('../../player/PlayerProvider', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react')
  const subscribe = (listener: () => void): (() => void) => {
    mockListeners.add(listener)
    return () => mockListeners.delete(listener)
  }
  return {
    usePlayer: () => ({ current: useSyncExternalStore(subscribe, () => mockCurrent) }),
    usePlayerCommands: () => ({ forgetSongs: () => mockLoad(null) }),
  }
})
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({ dropDownloads: () => Promise.resolve() }),
}))
// The server's answer, held until the test gives it.
let mockAnswer: ((result: { removed: number; failed: number[] }) => void) | null = null
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  // The dialog watches its songs leave the library; nothing leaves it here.
  useLibrary: () => ({ data: undefined }),
  useBulkDeleteSongs: () => ({
    isPending: false,
    mutate: (
      _variables: unknown,
      callbacks: { onSuccess: (result: { removed: number; failed: number[] }) => void },
    ) => {
      mockAnswer = callbacks.onSuccess
    },
  }),
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: true, dense: true, compact: false, finePointer: true, width: 1280 }
  return {
    useLayout: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 1280, height: 800, scale: 2, fontScale: 1 }),
  }
})

const SONG = { id: 4, title: 'Nocturne', artist: 'Klara Feld' } as unknown as Song

/** A page drawn the way both layouts draw it: the song's page or nothing, and the dialog beside. */
function Page(): React.ReactNode {
  const { song, onRemove, removeDialog } = useNowPlayingSong()
  return (
    <>
      {song ? (
        <Text onPress={() => onRemove(song)}>Remove {song.title}</Text>
      ) : (
        <Text>Nothing playing</Text>
      )}
      {removeDialog}
    </>
  )
}

const METRICS = {
  frame: { x: 0, y: 0, width: 1280, height: 800 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

describe('removing the song Now Playing is the page of', () => {
  it('keeps asking through the song going, and puts the page away once answered', async () => {
    mockLoad(SONG)
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OverlayProvider>
          <Page />
        </OverlayProvider>
      </SafeAreaProvider>,
    )

    await fireEvent.press(screen.getByText('Remove Nocturne'))
    expect(await screen.findByText('Delete “Nocturne” from your library?')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Delete song' }))

    // The player has let the song go; the server has not answered yet. The
    // page is under the dialog still asking, hidden from a screen reader.
    expect(screen.getByText('Nothing playing', { includeHiddenElements: true })).toBeTruthy()
    expect(mockPutAway).not.toHaveBeenCalled()

    await act(async () => mockAnswer?.({ removed: 1, failed: [] }))
    expect(screen.queryByText('Delete “Nocturne” from your library?')).toBeNull()
    expect(mockPutAway).toHaveBeenCalledTimes(1)
  })
})
