import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@selfmp3/client'

import { ImportScreen } from './ImportScreen'

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: () => undefined,
    replace: () => undefined,
    setParams: () => undefined,
  }),
  useLocalSearchParams: () => ({}),
}))
jest.mock('./ImportListen', () => ({
  useListen: () => ({ listening: null, start: () => undefined, stop: () => undefined }),
  ListenBar: () => null,
  ListenButton: () => null,
}))

const mockImportPreview = jest.fn()
jest.mock('./importSource', () => {
  // One object for the life of the test: the screen keys effects on its parts,
  // and a fresh library every render is a render that never settles.
  const source = {
    api: { importPreview: (input: string) => mockImportPreview(input) },
    library: { songs: [], tags: [], playlists: [] },
    tools: { ytDlp: true, ffmpeg: true },
    refetchTools: () => Promise.resolve(),
    queue: { jobs: [], pacing: null },
    invalidateQueue: () => Promise.resolve(),
    invalidateLibrary: () => Promise.resolve(),
  }
  return { useImportSource: () => source }
})

/**
 * The server going away while the Import screen is open.
 *
 * Found by a preprod run, 2026-09-17: with the server stopped, Fetch details
 * answered "Failed to fetch" — the browser's words — and nothing else happened.
 * The screen that says what to do instead ("add it anyway, your server takes it
 * when it wakes") is only drawn once the look-out notices, which is every
 * twenty seconds in a tab somebody is looking at and never in one they are not.
 */
describe('Import, when the server it found stops answering', () => {
  const via = { baseUrl: 'https://music.example.com', token: 't' }
  const draw = (onUnreachable: () => void): void => {
    // Nothing is collected on a timer: a pending one keeps jest from exiting.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })
    render(
      <QueryClientProvider client={client}>
        <ImportScreen via={via} onUnreachable={onUnreachable} />
      </QueryClientProvider>,
    )
  }
  const fetchDetails = async (): Promise<void> => {
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Links to import'), 'https://youtu.be/abc')
    })
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch details'))
    })
  }

  beforeEach(() => mockImportPreview.mockReset())

  it('looks for the server again, and says so in words', async () => {
    mockImportPreview.mockRejectedValue(new ApiError(0, 'Failed to fetch', 'offline'))
    const lookAgain = jest.fn()
    await act(async () => draw(lookAgain))

    await fetchDetails()

    await waitFor(() => expect(lookAgain).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/Your server stopped answering/)).toBeTruthy()
    expect(screen.queryByText('Failed to fetch')).toBeNull()
  })

  it('leaves a refusal from a server that did answer as the server worded it', async () => {
    mockImportPreview.mockRejectedValue(new ApiError(400, 'That is not a link this can read.'))
    const lookAgain = jest.fn()
    await act(async () => draw(lookAgain))

    await fetchDetails()

    await waitFor(() => expect(screen.getByText('That is not a link this can read.')).toBeTruthy())
    expect(lookAgain).not.toHaveBeenCalled()
  })
})
