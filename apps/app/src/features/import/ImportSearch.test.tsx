import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, type Api } from '@selfmp3/client'
import type { ImportPreviewItem } from '@selfmp3/shared'

import { ImportScreen } from './ImportScreen'
import { draftFor, resetImportDraft } from './importDraft'

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useRouter: () => ({
    push: () => undefined,
    back: () => undefined,
    replace: () => undefined,
    setParams: () => undefined,
    canGoBack: () => false,
  }),
  useNavigation: () => ({ getState: () => undefined }),
  usePathname: () => '/',
  useLocalSearchParams: () => ({}),
}))

// The floating chrome's room reads the player; there is no player here.
jest.mock('../../shell/bottomInset', () => ({
  useFootInset: () => 0,
  useBottomInset: () => 0,
}))

const mockListen = {
  listening: null,
  toggle: () => undefined,
  seek: () => undefined,
  close: () => undefined,
}
jest.mock('./ImportListen', () => ({
  ...jest.requireActual('./ImportListen'),
  useListen: () => mockListen,
}))

const mockSearch = jest.fn()
const mockEnqueue = jest.fn()
const mockFind = jest.fn()
jest.mock('./importSource', () => {
  let source: unknown = null
  return {
    useImportSource: () => {
      source ??= {
        api: {
          importSearch: (query: string) => mockSearch(query),
          importFind: (tracks: unknown) => mockFind(tracks),
          importEnqueue: (request: unknown) => mockEnqueue(request),
          importPreview: () => Promise.reject(new Error('not looked up here')),
        },
        library: { songs: [], tags: [], playlists: [] },
        tools: { ytdlp: true, ffmpeg: true },
        refetchTools: () => Promise.resolve(),
        queue: { jobs: [], active: 0, queued: 0, done: 0, pacing: null, run: null },
        history: undefined,
        invalidateQueue: () => Promise.resolve(),
        editQueue: () => undefined,
        invalidateLibrary: () => Promise.resolve(),
      }
      return source
    },
  }
})

configureClient({
  api: {
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => true,
    library: () => Promise.resolve({ songs: [], tags: [], playlists: [] }),
  } as unknown as Api,
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const song = (id: string, title: string, artist: string): ImportPreviewItem => ({
  url: `https://music.youtube.com/watch?v=${id}`,
  title,
  artist,
  album: '',
  duration: 240,
  thumbnail: null,
  alreadyHave: false,
  waitingToUpload: false,
  inQueue: false,
  source: 'youtube',
  netease: null,
  youtube: null,
})

const ANSWERS: Record<string, ImportPreviewItem[]> = {
  孤勇者: [song('a', '孤勇者', '陈奕迅'), song('b', '孤勇者 (现场)', '安達組合')],
  yorushika: [song('c', 'ヒッチコック', 'ヨルシカ'), song('d', '又三郎', 'ヨルシカ')],
}

/**
 * Searching from Import's box (docs/features/import-sources.md, "Searching"):
 * one line of words finds songs on YouTube Music and 网易云 as it is typed,
 * a few are ticked over one search or several, and Import brings them in.
 */
describe('Import, searching for songs', () => {
  const draw = async (): Promise<void> => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <ImportScreen />
        </QueryClientProvider>
      </SafeAreaProvider>,
    )
  }
  const type = async (text: string): Promise<void> => {
    await fireEvent.changeText(screen.getByLabelText('Links to import'), text)
  }

  beforeEach(() => {
    resetImportDraft()
    mockSearch
      .mockReset()
      .mockImplementation((query: string) => Promise.resolve({ items: ANSWERS[query] ?? [] }))
    mockEnqueue.mockReset().mockResolvedValue({ jobs: [], skipped: 0, playlistId: null })
    mockFind.mockReset()
  })

  it('finds songs as the words are typed, and ticks none of them', async () => {
    await draw()
    await type('孤勇者')
    expect(await screen.findByText('安達組合')).toBeTruthy()
    expect(mockSearch).toHaveBeenCalledWith('孤勇者')
    expect(screen.getByLabelText('Select 孤勇者')).toBeTruthy()
    expect(screen.queryByTestId('import-picked')).toBeNull()
    // A search has nothing to look up: what it found is already there.
    expect(screen.queryByTestId('import-look-up')).toBeNull()
  })

  it('imports the songs ticked over two searches, then starts afresh', async () => {
    await draw()
    await type('孤勇者')
    await fireEvent.press(await screen.findByLabelText('Select 孤勇者'))
    await type('yorushika')
    await fireEvent.press(await screen.findByLabelText('Select 又三郎'))
    // The song ticked in the first search is still there, above the second's.
    expect(await screen.findByText('Picked: 孤勇者, 又三郎')).toBeTruthy()
    expect(screen.getByText('Picked')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('import-picked-commit'))
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1))
    const request = mockEnqueue.mock.calls[0]?.[0] as { items: { url: string }[] }
    expect(request.items.map(item => item.url)).toEqual([
      'https://music.youtube.com/watch?v=a',
      'https://music.youtube.com/watch?v=d',
    ])
    await waitFor(() => expect(draftFor('own')).toMatchObject({ links: '', search: null }))
  })

  it('looks up two lines as a list of names, and a link as a link, never as a search', async () => {
    await draw()
    await type('Daft Punk - Get Lucky\nRadiohead - Creep')
    expect(screen.getByTestId('import-look-up')).toBeTruthy()
    await type('https://youtu.be/dGZqpVCJP3k')
    expect(screen.getByTestId('import-look-up')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('says when nothing was found, and when the search failed, with a way to try again', async () => {
    await draw()
    await type('zzzz')
    expect(await screen.findByText('Nothing found for “zzzz”.')).toBeTruthy()
    mockSearch.mockRejectedValueOnce(new Error('Failed to fetch'))
    await type('孤勇者')
    expect(await screen.findByText('Could not search')).toBeTruthy()
    await fireEvent.press(screen.getByText('Try again'))
    expect(await screen.findByText('安達組合')).toBeTruthy()
  })
})
