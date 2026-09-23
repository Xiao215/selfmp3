import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ImportJob } from '@selfmp3/shared'

import { ImportScreen } from './ImportScreen'

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: () => undefined,
    back: () => undefined,
    replace: () => undefined,
    setParams: () => undefined,
    canGoBack: () => false,
  }),
  useNavigation: () => ({ getState: () => undefined }),
  useLocalSearchParams: () => ({}),
}))

const mockPauseImports = jest.fn()
const mockResumeImports = jest.fn()
const mockInvalidateQueue = jest.fn()
const mockJobs: ImportJob[] = []
jest.mock('./importSource', () => {
  // The mock is made before the jobs above exist, so the queue is read when the screen asks.
  const source = {
    api: {
      importPreview: () => Promise.reject(new Error('not looked up here')),
      pauseImports: () => mockPauseImports(),
      resumeImports: () => mockResumeImports(),
    },
    library: { songs: [], tags: [], playlists: [] },
    tools: { ytdlp: true, ffmpeg: true },
    refetchTools: () => Promise.resolve(),
    get queue() {
      return { jobs: mockJobs, active: 0, queued: 0, pacing: null }
    },
    invalidateQueue: () => mockInvalidateQueue(),
    invalidateLibrary: () => Promise.resolve(),
  }
  return { useImportSource: () => source }
})

/**
 * Pause all and Resume all, beside Now: the whole queue at once, each offered
 * only while it would do something. Forty cancelled rows were forty Retries.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const job = (id: string, over: Partial<ImportJob>): ImportJob => ({
  id,
  url: `https://youtu.be/${id}`,
  status: 'queued',
  step: 'waiting',
  progress: null,
  title: id,
  artist: '',
  album: '',
  thumbnail: null,
  duration: 0,
  error: null,
  songId: null,
  attempts: 0,
  tagIds: [],
  createdAt: '2026-09-22T09:00:00.000Z',
  updatedAt: '2026-09-22T09:00:00.000Z',
  ...over,
})

describe('Import, the whole queue at once', () => {
  const draw = (...jobs: ImportJob[]): void => {
    mockJobs.splice(0, mockJobs.length, ...jobs)
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <ImportScreen />
        </QueryClientProvider>
      </SafeAreaProvider>,
    )
  }

  beforeEach(() => {
    mockPauseImports.mockReset().mockResolvedValue({ paused: 0 })
    mockResumeImports.mockReset().mockResolvedValue({ resumed: 0 })
    mockInvalidateQueue.mockReset().mockResolvedValue(undefined)
  })

  it('offers Pause all while anything is downloading or waiting, and pauses the queue', async () => {
    await act(async () =>
      draw(job('one', { status: 'running', step: 'downloading', progress: 40 }), job('two', {})),
    )
    expect(screen.queryByTestId('import-resume-all')).toBeNull()

    await act(async () => {
      fireEvent.press(screen.getByTestId('import-pause-all'))
    })

    expect(mockPauseImports).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockInvalidateQueue).toHaveBeenCalledTimes(1))
  })

  it('offers Resume all while anything was paused, and resumes the queue', async () => {
    await act(async () =>
      draw(
        job('one', { status: 'cancelled', step: 'finished' }),
        job('two', { status: 'error', step: 'downloading', error: 'Video unavailable' }),
      ),
    )
    expect(screen.queryByTestId('import-pause-all')).toBeNull()

    await act(async () => {
      fireEvent.press(screen.getByTestId('import-resume-all'))
    })

    expect(mockResumeImports).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockInvalidateQueue).toHaveBeenCalledTimes(1))
  })

  it('offers both while a paused queue has one still going, and neither once all is in', async () => {
    await act(async () =>
      draw(
        job('one', { status: 'cancelled', step: 'finished' }),
        job('two', { status: 'running', step: 'resolving' }),
      ),
    )
    expect(screen.getByTestId('import-pause-all')).toBeTruthy()
    expect(screen.getByTestId('import-resume-all')).toBeTruthy()

    screen.unmount()
    await act(async () => draw(job('one', { status: 'done', step: 'finished' })))
    expect(screen.queryByTestId('import-pause-all')).toBeNull()
    expect(screen.queryByTestId('import-resume-all')).toBeNull()
  })
})
