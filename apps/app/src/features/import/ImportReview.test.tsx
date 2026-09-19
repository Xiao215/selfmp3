import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { reviewFrom } from '@selfmp3/client'

import { ImportReview } from './ImportReview'
import { patchDraft, resetImportDraft } from './importDraft'

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({
    back: () => undefined,
    replace: () => undefined,
    navigate: () => undefined,
    canGoBack: () => true,
  }),
  useNavigation: () => ({ getState: () => undefined }),
}))

// The floating chrome's room reads the player; there is no player here.
jest.mock('../../shell/bottomInset', () => ({ useBottomInset: () => 0 }))

jest.mock('./ImportListen', () => ({
  ...jest.requireActual('./ImportListen'),
  useListen: () => ({
    listening: null,
    toggle: () => undefined,
    seek: () => undefined,
    close: () => undefined,
  }),
}))

const mockEnqueue = jest.fn()
jest.mock('./importSource', () => {
  // One object for the life of the test, as ImportUnreachable.test.tsx says why.
  const source = {
    api: { importEnqueue: (request: unknown) => mockEnqueue(request) },
    library: { songs: [], tags: [], playlists: [] },
    tools: { ytdlp: true, ffmpeg: true },
    refetchTools: () => Promise.resolve(),
    queue: { jobs: [], pacing: null },
    invalidateQueue: () => Promise.resolve(),
    invalidateLibrary: () => Promise.resolve(),
  }
  return { useImportSource: () => source }
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const item = (n: number, title: string, alreadyHave = false) => ({
  url: `https://open.example/${n}`,
  title,
  artist: 'YOASOBI',
  album: '',
  duration: 240,
  thumbnail: null,
  alreadyHave,
})

const draw = async (): Promise<void> => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  })
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <ImportReview />
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

/**
 * The review on a phone (`P30`): everything is coming in, a song can be left
 * out and brought back — the swipe's twin for a screen reader is the row's
 * action — and a tapped row opens to rename the song.
 */
describe('Import review, on a phone', () => {
  beforeEach(() => {
    mockEnqueue.mockReset()
    patchDraft('own', {
      review: reviewFrom({
        kind: 'playlist',
        playlistTitle: 'THE BOOK',
        items: [item(1, 'アイドル', true), item(2, '群青'), item(3, '怪物')],
      }),
    })
  })
  // The page is still drawn when the draft empties; that is an update like any other.
  afterEach(() => act(() => resetImportDraft()))

  it('counts every song but the one that is yours already', async () => {
    await draw()
    expect(screen.getByText('THE BOOK')).toBeTruthy()
    expect(screen.getByText('Yours already')).toBeTruthy()
    expect(screen.getByTestId('import-count').props['children']).toBe('2 of 3 in')
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
    // No checkbox anywhere: coming in is the default, not a tick.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('leaves a song out, keeps it listed, and brings it back', async () => {
    await draw()
    const row = screen.getByLabelText('怪物, YOASOBI')
    await act(async () => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'leaveOut' } })
    })
    expect(screen.getByText('Left out')).toBeTruthy()
    expect(screen.getByText('怪物')).toBeTruthy()
    expect(screen.getByText('Import 1 song')).toBeTruthy()

    await act(async () => {
      fireEvent(screen.getByLabelText('怪物, YOASOBI'), 'accessibilityAction', {
        nativeEvent: { actionName: 'leaveOut' },
      })
    })
    expect(screen.queryByText('Left out')).toBeNull()
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
  })

  it('opens a song to rename it, and sends the new name with no playlist', async () => {
    await draw()
    await act(async () => {
      fireEvent.press(screen.getByLabelText('群青, YOASOBI'))
    })
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Artist of track 2'), 'YOASOBI feat. 合唱')
    })
    // No album field: a title and an artist are what a song is named by.
    expect(screen.queryByLabelText('Album of track 2')).toBeNull()

    await act(async () => {
      fireEvent.press(screen.getByTestId('import-commit'))
    })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const request = mockEnqueue.mock.calls[0][0]
    expect(request.items.map((song: { title: string }) => song.title)).toEqual(['群青', '怪物'])
    expect(request.items[0].artist).toBe('YOASOBI feat. 合唱')
    expect(request.playlistId).toBeNull()
    expect(request.createPlaylistName).toBeNull()
  })
})
