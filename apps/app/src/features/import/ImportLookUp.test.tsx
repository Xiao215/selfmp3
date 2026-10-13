import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '@selfmp3/client'

import { ImportScreen } from './ImportScreen'
import { resetImportDraft } from './importDraft'

// A search's songs are heard through the preview player; nothing is searched for here.
jest.mock('./ImportListen', () => ({
  ...jest.requireActual('./ImportListen'),
  useListen: () => mockListen,
}))
const mockListen = {
  listening: null,
  toggle: () => undefined,
  seek: () => undefined,
  close: () => undefined,
}

jest.mock('expo-router', () => ({
  // The search's rows stop their preview when the page is left; here it never is.
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

const mockImportPreview = jest.fn()
jest.mock('./importSource', () => {
  const source = {
    api: {
      importPreview: (input: string) => mockImportPreview(input),
      importAlreadyHave: () => Promise.resolve({ have: [] }),
    },
    library: { songs: [], tags: [], playlists: [] },
    tools: { ytdlp: true, ffmpeg: true },
    refetchTools: () => Promise.resolve(),
    queue: { jobs: [], done: 0, pacing: null },
    invalidateQueue: () => Promise.resolve(),
    invalidateLibrary: () => Promise.resolve(),
  }
  return { useImportSource: () => source }
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/**
 * The link box after a look-up. Found on a phone, 2026-10-12: a link looked up,
 * Import left and come back to, and the link was still in the box as though
 * it had never been looked up — its review waiting in the card under it.
 */
describe('Import, coming back after a look-up', () => {
  const draw = async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })
    return render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <ImportScreen />
        </QueryClientProvider>
      </SafeAreaProvider>,
    )
  }
  const lookUp = async (): Promise<void> => {
    await act(async () => {
      await fireEvent.changeText(screen.getByLabelText('Links to import'), 'https://youtu.be/abc')
    })
    await act(async () => {
      await fireEvent.press(screen.getByText('Look it up'))
    })
  }

  beforeEach(() => {
    mockImportPreview.mockReset()
    resetImportDraft()
  })

  it('finds the box empty and the review in the card', async () => {
    mockImportPreview.mockResolvedValue({
      from: 'youtube',
      kind: 'video',
      playlistTitle: null,
      items: [
        {
          url: 'https://www.youtube.com/watch?v=abc',
          title: '群青',
          artist: 'YOASOBI',
          album: null,
          duration: 250,
          thumbnail: null,
          alreadyHave: false,
          waitingToUpload: false,
          inQueue: false,
          source: 'youtube',
          netease: null,
          youtube: null,
        },
      ],
    })
    const first = await act(async () => draw())
    await lookUp()
    await waitFor(() => expect(mockImportPreview).toHaveBeenCalledWith('https://youtu.be/abc'))
    await act(async () => first.unmount())

    await act(async () => draw())
    expect(screen.getByLabelText('Links to import').props['value']).toBe('')
    expect(screen.getByTestId('import-resume-review')).toBeTruthy()
  })

  it('keeps a link that could not be looked up, to be put right', async () => {
    mockImportPreview.mockRejectedValue(new ApiError(400, 'That is not a link this can read.'))
    const first = await act(async () => draw())
    await lookUp()
    await waitFor(() => expect(screen.getByText('That is not a link this can read.')).toBeTruthy())
    await act(async () => first.unmount())

    await act(async () => draw())
    expect(screen.getByLabelText('Links to import').props['value']).toBe('https://youtu.be/abc')
  })
})
