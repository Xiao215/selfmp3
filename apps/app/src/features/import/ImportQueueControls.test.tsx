import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ImportJob, ImportPacing, ImportRun } from '@selfmp3/shared'

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
const mockRetryFailed = jest.fn()
const mockRemoveFailed = jest.fn()
const mockCancelImport = jest.fn()
const mockRetryImport = jest.fn()
const mockDismissImport = jest.fn()
const mockImportNext = jest.fn()
const mockInvalidateQueue = jest.fn()
const mockEditQueue = jest.fn()
const mockJobs: ImportJob[] = []
/** How many finished jobs the server counts, beyond the few it sends. */
let mockDone = 0
let mockPacing: ImportPacing = { waitMs: 0, pausedUntil: null, ratchet: 1 }
let mockRun: ImportRun | null = null
jest.mock('./importSource', () => {
  // The mock is made before the jobs above exist, so the queue is read when the screen asks.
  const source = {
    api: {
      importPreview: () => Promise.reject(new Error('not looked up here')),
      pauseImports: () => mockPauseImports(),
      resumeImports: () => mockResumeImports(),
      retryFailedImports: () => mockRetryFailed(),
      removeFailedImports: () => mockRemoveFailed(),
      cancelImport: (id: string) => mockCancelImport(id),
      retryImport: (id: string) => mockRetryImport(id),
      dismissImport: (id: string) => mockDismissImport(id),
      importNext: (id: string) => mockImportNext(id),
    },
    library: { songs: [], tags: [], playlists: [] },
    tools: { ytdlp: true, ffmpeg: true },
    refetchTools: () => Promise.resolve(),
    get queue() {
      return {
        jobs: mockJobs,
        active: 0,
        queued: 0,
        done: mockDone,
        pacing: mockPacing,
        run: mockRun,
      }
    },
    history: undefined,
    invalidateQueue: () => mockInvalidateQueue(),
    editQueue: (change: unknown) => mockEditQueue(change),
    invalidateLibrary: () => Promise.resolve(),
  }
  return { useImportSource: () => source }
})

/**
 * Pause all and Resume all beside Currently importing, Retry all and Remove
 * all beside Couldn't import: the whole queue at once, each offered only while
 * it would do something. Forty failed rows were forty Retries.
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
  const draw = async (...jobs: ImportJob[]): Promise<void> => {
    mockJobs.splice(0, mockJobs.length, ...jobs)
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })
    await render(
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
    mockRetryFailed.mockReset().mockResolvedValue({ retried: 0 })
    mockRemoveFailed.mockReset().mockResolvedValue({ removed: 0 })
    mockCancelImport.mockReset().mockResolvedValue({ ok: true })
    mockRetryImport.mockReset().mockResolvedValue({ ok: true })
    mockDismissImport.mockReset().mockResolvedValue({ ok: true })
    mockImportNext.mockReset().mockResolvedValue({ ok: true })
    mockInvalidateQueue.mockReset().mockResolvedValue(undefined)
    mockEditQueue.mockReset()
  })

  it('offers Pause all while anything is downloading or waiting, and pauses the queue', async () => {
    await act(async () =>
      draw(job('one', { status: 'running', step: 'downloading', progress: 40 }), job('two', {})),
    )
    expect(screen.queryByTestId('import-resume-all')).toBeNull()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-pause-all'))
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
      await fireEvent.press(screen.getByTestId('import-resume-all'))
    })

    expect(mockResumeImports).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockInvalidateQueue).toHaveBeenCalledTimes(1))
  })

  it('keeps what failed under its own name, and retries or removes all of it at once', async () => {
    await act(async () =>
      draw(
        job('one', { status: 'error', step: 'finished', error: 'Video unavailable' }),
        job('two', { status: 'error', step: 'downloading', error: 'Timed out' }),
        job('three', { status: 'running', step: 'downloading', progress: 40 }),
      ),
    )
    expect(screen.getByTestId('import-importing')).toHaveTextContent('Currently importing')
    expect(screen.getByTestId('import-failed')).toHaveTextContent('Couldn’t import')

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-retry-all'))
    })
    // Drawn at once, then sent, then read back.
    expect(mockEditQueue).toHaveBeenCalledWith({ kind: 'retry' })
    expect(mockRetryFailed).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockInvalidateQueue).toHaveBeenCalledTimes(1))

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-remove-failed'))
    })
    expect(mockEditQueue).toHaveBeenLastCalledWith({ kind: 'remove' })
    expect(mockRemoveFailed).toHaveBeenCalledTimes(1)
  })

  it('leaves one failure to its own Retry, which it draws at once', async () => {
    await act(async () =>
      draw(job('one', { status: 'error', step: 'finished', error: 'Video unavailable' })),
    )
    expect(screen.queryByTestId('import-retry-all')).toBeNull()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-retry-one'))
    })
    expect(mockEditQueue).toHaveBeenCalledWith({ kind: 'retry', id: 'one' })
    expect(mockRetryImport).toHaveBeenCalledWith('one')
  })

  it('pauses one waiting row and resumes one paused row, each in its place', async () => {
    await act(async () =>
      draw(job('one', {}), job('two', { status: 'cancelled', step: 'finished' })),
    )
    expect(screen.getByTestId('import-importing')).toBeTruthy()
    expect(screen.getByText('Paused')).toBeTruthy()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-pause-one'))
    })
    expect(mockEditQueue).toHaveBeenCalledWith({ kind: 'pause', id: 'one' })
    expect(mockCancelImport).toHaveBeenCalledWith('one')

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-resume-two'))
    })
    expect(mockEditQueue).toHaveBeenLastCalledWith({ kind: 'resume', id: 'two' })
    expect(mockRetryImport).toHaveBeenCalledWith('two')
  })

  it('lists twenty rows of a long queue, and shows the rest when asked', async () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      job(`song${i}`, i < 2 ? { status: 'running', step: 'downloading', progress: 10 } : {}),
    )
    await act(async () => draw(...many))
    expect(screen.getByText('song19')).toBeTruthy()
    expect(screen.queryByText('song20')).toBeNull()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-importing-more'))
    })
    expect(screen.getByText('song22')).toBeTruthy()
    expect(screen.getByTestId('import-importing-more')).toHaveTextContent('Show fewer')
  })

  it('shows the queue’s progress, not a bar per song, and how long is left', async () => {
    mockRun = { done: 12, total: 64, leftMs: 38 * 60_000 }
    await act(async () => draw(job('one', { status: 'running', step: 'downloading', progress: 0 })))
    expect(screen.getByTestId('import-run')).toHaveTextContent('12 of 64 inabout 38 min left')
    // The song's own line names its step; no percentage stuck at 0.
    expect(screen.getByText('Downloading audio')).toBeTruthy()

    await screen.unmount()
    mockRun = { done: 12, total: 64, leftMs: null }
    await act(async () => draw(job('one', { status: 'cancelled', step: 'finished' })))
    expect(screen.getByTestId('import-run')).toHaveTextContent('12 of 64 inPaused')
    mockRun = null
  })

  it('counts the next song’s turn down, and only the next song’s', async () => {
    mockPacing = { waitMs: 38_000, pausedUntil: null, ratchet: 0.5 }
    await act(async () =>
      draw(job('one', { status: 'running', step: 'uploading' }), job('two', {}), job('three', {})),
    )
    expect(screen.getByText('Starts in 0:38 · pacing YouTube')).toBeTruthy()
    expect(screen.getAllByText('Waiting in queue')).toHaveLength(1)

    await screen.unmount()
    mockPacing = { waitMs: 600_000, pausedUntil: Date.now() + 600_000, ratchet: 0.5 }
    await act(async () => draw(job('two', {})))
    expect(screen.getByText('Starts in 10:00 · YouTube asked us to slow down')).toBeTruthy()
    mockPacing = { waitMs: 0, pausedUntil: null, ratchet: 1 }
  })

  it('says what the server refused, and reads the queue back as it is', async () => {
    mockCancelImport.mockRejectedValue(new Error('that job is already adding its song'))
    await act(async () => draw(job('one', {})))

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-pause-one'))
    })
    await waitFor(() =>
      expect(screen.getByText('that job is already adding its song')).toBeTruthy(),
    )
    expect(mockInvalidateQueue).toHaveBeenCalledTimes(1)
  })

  it('lets any row short of adding its song be removed for good, and not one past that', async () => {
    await act(async () =>
      draw(
        job('one', { status: 'error', step: 'finished', error: 'Video unavailable' }),
        job('two', { status: 'running', step: 'downloading', progress: 40 }),
        job('three', {}),
        job('four', { status: 'running', step: 'saving' }),
      ),
    )
    expect(screen.getByTestId('import-dismiss-two')).toBeTruthy()
    expect(screen.getByTestId('import-dismiss-three')).toBeTruthy()
    expect(screen.queryByTestId('import-dismiss-four')).toBeNull()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-dismiss-one'))
    })

    expect(mockDismissImport).toHaveBeenCalledWith('one')
    await waitFor(() => expect(mockInvalidateQueue).toHaveBeenCalledTimes(1))
  })

  it('imports a waiting or paused song next, and offers it to no song already next', async () => {
    await act(async () =>
      draw(
        job('one', { status: 'running', step: 'downloading', progress: 40 }),
        job('two', {}),
        job('three', {}),
        job('four', { status: 'cancelled', step: 'finished' }),
      ),
    )
    expect(screen.queryByTestId('import-next-one')).toBeNull()
    expect(screen.queryByTestId('import-next-two')).toBeNull()
    expect(screen.getByTestId('import-next-four')).toBeTruthy()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-next-three'))
    })

    expect(mockEditQueue).toHaveBeenCalledWith({ kind: 'next', id: 'three' })
    expect(mockImportNext).toHaveBeenCalledWith('three')
    await waitFor(() => expect(mockInvalidateQueue).toHaveBeenCalledTimes(1))
  })

  it('counts the whole history under Earlier today, not only the few rows it was sent', async () => {
    mockDone = 7
    await act(async () => draw(job('one', { status: 'done', step: 'finished' })))
    expect(screen.getByTestId('import-show-all')).toHaveTextContent('Show all 7')
    mockDone = 0
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

    await screen.unmount()
    await act(async () => draw(job('one', { status: 'done', step: 'finished' })))
    expect(screen.queryByTestId('import-pause-all')).toBeNull()
    expect(screen.queryByTestId('import-resume-all')).toBeNull()
  })
})
