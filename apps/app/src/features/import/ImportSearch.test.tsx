import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, type Api } from '@selfmp3/client'
import type { ImportPreviewItem } from '@selfmp3/shared'

import { ImportScreen } from './ImportScreen'
import { ImportSearch } from './ImportSearch'
import { draftFor, patchDraft, resetImportDraft } from './importDraft'
import { withSearchResults } from './importDraft.model'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockParams: { q?: string } = {}
jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useRouter: () => ({
    push: (to: unknown) => mockPush(to),
    back: () => undefined,
    replace: (to: unknown) => mockReplace(to),
    setParams: () => undefined,
    canGoBack: () => false,
  }),
  useNavigation: () => ({ getState: () => undefined }),
  usePathname: () => '/',
  useLocalSearchParams: () => mockParams,
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
jest.mock('./importSource', () => {
  let source: unknown = null
  return {
    useImportSource: () => {
      source ??= {
        api: {
          importSearch: (query: string) => mockSearch(query),
          importFind: () => Promise.resolve({ found: [] }),
          importEnqueue: (request: unknown) => mockEnqueue(request),
          importPreview: () => Promise.reject(new Error('not looked up here')),
        },
        library: { songs: [], tags: [], playlists: [] },
        createTag: () => Promise.reject(new Error('no tags here')),
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

const draw = async (page: 'import' | 'search'): Promise<void> => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        {page === 'import' ? <ImportScreen /> : <ImportSearch />}
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

beforeEach(() => {
  resetImportDraft()
  delete mockParams.q
  mockPush.mockReset()
  mockReplace.mockReset()
  mockSearch
    .mockReset()
    .mockImplementation((query: string) => Promise.resolve({ items: ANSWERS[query] ?? [] }))
  mockEnqueue.mockReset().mockResolvedValue({ jobs: [], skipped: 0, playlistId: null })
})

/**
 * Searching from Import's box (docs/features/import-sources.md, "Searching"):
 * one line of words is a search, made on a page of its own as a link's
 * review is.
 */
describe('Import, a search typed into the box', () => {
  const type = async (text: string): Promise<void> => {
    await fireEvent.changeText(screen.getByLabelText('Links to import'), text)
  }

  it('opens the search page with the words, and the box lets them go', async () => {
    await draw('import')
    await type('孤勇者\n')
    await fireEvent.press(screen.getByTestId('import-search'))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/import/search', params: { q: '孤勇者' } })
    expect(draftFor('own').links).toBe('')
    // Nothing is searched for on Import itself.
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('looks up two lines as a list of names, and a link as a link', async () => {
    await draw('import')
    await type('Daft Punk - Get Lucky\nRadiohead - Creep')
    expect(screen.getByTestId('import-look-up')).toBeTruthy()
    expect(screen.queryByTestId('import-search')).toBeNull()
    await type('https://youtu.be/dGZqpVCJP3k')
    expect(screen.getByTestId('import-look-up')).toBeTruthy()
  })

  it('offers songs picked in a search and not imported yet', async () => {
    const search = withSearchResults(null, '孤勇者', ANSWERS['孤勇者'] ?? [])
    patchDraft('own', {
      search: { ...search, review: { ...search.review, chosen: new Set([0]) } },
    })
    await draw('import')
    await fireEvent.press(screen.getByTestId('import-resume-search'))
    expect(mockPush).toHaveBeenCalledWith('/import/search')
    expect(screen.getByText('1 song picked · not imported yet')).toBeTruthy()
  })
})

describe('Import’s search page', () => {
  const type = async (text: string): Promise<void> => {
    await fireEvent.changeText(screen.getByLabelText('Search for songs'), text)
  }

  it('searches for the words it was opened with, and ticks none of what it finds', async () => {
    mockParams.q = '孤勇者'
    await draw('search')
    expect(await screen.findByText('安達組合')).toBeTruthy()
    expect(mockSearch).toHaveBeenCalledWith('孤勇者')
    expect(screen.getByLabelText('Select 孤勇者')).toBeTruthy()
    expect(screen.getByTestId('import-search-commit')).toBeDisabled()
  })

  it('imports the songs ticked over two searches, then goes back to Import afresh', async () => {
    mockParams.q = '孤勇者'
    await draw('search')
    await fireEvent.press(await screen.findByLabelText('Select 孤勇者'))
    await type('yorushika')
    await fireEvent.press(await screen.findByLabelText('Select 又三郎'))
    // The song ticked in the first search is still there, above the second's.
    expect(screen.getByText('Picked')).toBeTruthy()
    expect(screen.getByLabelText('Deselect 孤勇者')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('import-search-commit'))
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1))
    const request = mockEnqueue.mock.calls[0]?.[0] as { items: { url: string }[] }
    expect(request.items.map(item => item.url)).toEqual([
      'https://music.youtube.com/watch?v=a',
      'https://music.youtube.com/watch?v=d',
    ])
    await waitFor(() => expect(draftFor('own').search).toBeNull())
    expect(mockReplace).toHaveBeenCalledWith('/import')
  })

  it('says when nothing was found, and when the search failed, with a way to try again', async () => {
    await draw('search')
    await type('zzzz')
    expect(await screen.findByText('Nothing found for “zzzz”.')).toBeTruthy()
    mockSearch.mockRejectedValueOnce(new Error('Failed to fetch'))
    await type('孤勇者')
    expect(await screen.findByText('Could not search')).toBeTruthy()
    await fireEvent.press(screen.getByText('Try again'))
    expect(await screen.findByText('安達組合')).toBeTruthy()
  })
})
