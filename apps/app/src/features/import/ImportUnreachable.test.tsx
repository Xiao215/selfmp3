import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '@selfmp3/client'

import { ImportScreen } from './ImportScreen'

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: () => undefined,
    back: () => undefined,
    replace: () => undefined,
    setParams: () => undefined,
    canGoBack: () => false,
  }),
  // The head's way back asks the stack what is behind this page.
  useNavigation: () => ({ getState: () => undefined }),
  useLocalSearchParams: () => ({}),
}))

const mockImportPreview = jest.fn()
jest.mock('./importSource', () => {
  // One object for the life of the test: the screen keys effects on its parts,
  // and a fresh library every render is a render that never settles.
  const source = {
    api: { importPreview: (input: string) => mockImportPreview(input) },
    library: { songs: [], tags: [], playlists: [] },
    tools: { ytdlp: true, ffmpeg: true },
    refetchTools: () => Promise.resolve(),
    queue: { jobs: [], done: 0, pacing: null },
    invalidateQueue: () => Promise.resolve(),
    invalidateLibrary: () => Promise.resolve(),
  }
  return { useImportSource: () => source }
})

/**
 * The server going away while the Import screen is open.
 *
 * Found by a preprod run, 2026-09-17: with the server stopped, looking a link
 * up answered "Failed to fetch" — the browser's words — and nothing else happened.
 * The screen that says what to do instead ("add it anyway, your server takes it
 * when it wakes") is only drawn once the look-out notices, which is every
 * twenty seconds in a tab somebody is looking at and never in one they are not.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

describe('Import, when the server it found stops answering', () => {
  const via = { baseUrl: 'https://music.example.com', token: 't' }
  const draw = async (onUnreachable: () => void): Promise<void> => {
    // Nothing is collected on a timer: a pending one keeps jest from exiting.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })
    // "Tag it" holds a sheet, which reads the insets a device would give it.
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <ImportScreen via={via} onUnreachable={onUnreachable} />
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

  beforeEach(() => mockImportPreview.mockReset())

  it('looks for the server again, and says so in words', async () => {
    mockImportPreview.mockRejectedValue(new ApiError(0, 'Failed to fetch', 'offline'))
    const lookAgain = jest.fn()
    await act(async () => draw(lookAgain))

    await lookUp()

    await waitFor(() => expect(lookAgain).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/Your server stopped answering/)).toBeTruthy()
    expect(screen.queryByText('Failed to fetch')).toBeNull()
  })

  it('leaves a refusal from a server that did answer as the server worded it', async () => {
    mockImportPreview.mockRejectedValue(new ApiError(400, 'That is not a link this can read.'))
    const lookAgain = jest.fn()
    await act(async () => draw(lookAgain))

    await lookUp()

    await waitFor(() => expect(screen.getByText('That is not a link this can read.')).toBeTruthy())
    expect(lookAgain).not.toHaveBeenCalled()
  })
})
