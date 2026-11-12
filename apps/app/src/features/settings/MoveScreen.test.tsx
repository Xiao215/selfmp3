import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { MoveProgress } from '@selfmp3/replica'
import type { DriveBack } from '@selfmp3/shared'

import { MoveScreen } from './MoveScreen'

/**
 * Move your library: the page names one other place, starts the copy only
 * once that place is the doorman's to move to, says how far it has got, and
 * leaves a move it could not finish to be taken up again.
 */

const BUCKET = {
  kind: 'bucket' as const,
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  bucket: 'my-music',
  prefix: 'selfmp3',
  keyIdHint: '004abc…',
}
const DRIVE = { kind: 'drive' as const, folder: '1AbC' }

let mockStorage: typeof BUCKET | typeof DRIVE = BUCKET
let mockMoving: typeof BUCKET | typeof DRIVE | null = null
const session = () => ({
  doormanUrl: 'https://doorman.test',
  token: 't',
  me: { storage: mockStorage },
})

const mockBegin = jest.fn((..._args: unknown[]) => Promise.resolve())
const mockStart = jest.fn((..._args: unknown[]) => Promise.resolve<typeof BUCKET | null>(BUCKET))
const mockStop = jest.fn(() => Promise.resolve())
jest.mock('../../replica', () => ({
  session: {
    loadSession: () => Promise.resolve(session()),
    refreshSession: () => Promise.resolve(session()),
    movingTo: () => Promise.resolve(mockMoving),
    beginDriveConnect: (...args: unknown[]) => mockBegin(...args),
    startMove: (...args: unknown[]) => mockStart(...args),
    stopMove: () => mockStop(),
    moveApi: () => ({}),
  },
}))

interface RunOptions {
  onProgress: (progress: MoveProgress) => void
  stopped: () => boolean
}
let mockRun: (options: RunOptions) => Promise<boolean> = () => Promise.resolve(true)
jest.mock('@selfmp3/replica', () => ({
  ...jest.requireActual<object>('@selfmp3/replica'),
  runMove: (_api: unknown, options: RunOptions) => mockRun(options),
}))

let mockBack: (back: DriveBack) => void = () => undefined
jest.mock('../../ports/signInReturn', () => ({
  signInReturnUrl: (target: string) => `selfmp3://${target}`,
  onSignInBack: (_target: string, listener: (back: DriveBack) => void) => {
    mockBack = listener
    return () => undefined
  },
}))
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
const mockInvalidate = jest.fn(() => Promise.resolve())
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutFlags: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

async function shown(): Promise<void> {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MoveScreen />
    </SafeAreaProvider>,
  )
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStorage = BUCKET
  mockMoving = null
  mockRun = () => Promise.resolve(true)
})

it('offers a library in a bucket Google Drive, and nothing else', async () => {
  await shown()
  expect(screen.getByText('Now in my-music on Backblaze, us-west-004')).toBeTruthy()
  expect(screen.getByTestId('move-drive')).toBeTruthy()
  expect(screen.queryByTestId('move-key-id')).toBeNull()
})

it('asks Google for Drive as somewhere to move to, and copies once Google says yes', async () => {
  let progress: (progress: MoveProgress) => void = () => undefined
  let end: (finished: boolean) => void = () => undefined
  mockRun = options => {
    progress = options.onProgress
    return new Promise(resolve => {
      end = resolve
    })
  }
  await shown()
  await fireEvent.press(screen.getByTestId('move-drive'))
  expect(mockBegin).toHaveBeenCalledWith(expect.anything(), 'selfmp3://move', true)
  expect(screen.getByText('Waiting for Google. Finish there, then come back here.')).toBeTruthy()

  mockMoving = DRIVE
  await act(async () => {
    mockBack({ kind: 'connected' })
    await Promise.resolve()
  })
  await act(async () => {
    progress({ phase: 'songs', done: 412, total: 1930 })
    await Promise.resolve()
  })
  expect(screen.getByText('Moving 412 of 1,930 songs')).toBeTruthy()

  await act(async () => {
    end(true)
    await Promise.resolve()
  })
  expect(
    screen.getByText(
      'Your library is now in the self.mp3 folder in your Google Drive. The copy in my-music on Backblaze, us-west-004 was left as it was; you can delete it there.',
    ),
  ).toBeTruthy()
  expect(mockInvalidate).toHaveBeenCalled()
})

it('says why Google’s page ended without a Drive to move to', async () => {
  await shown()
  await fireEvent.press(screen.getByTestId('move-drive'))
  await act(async () => {
    mockBack({ kind: 'refused', refusal: 'holds-library' })
    await Promise.resolve()
  })
  expect(screen.getByText(/already has a library/)).toBeTruthy()
  expect(screen.getByTestId('move-drive')).toBeTruthy()
})

it('offers a library in Google Drive a bucket, tried before anything is copied', async () => {
  mockStorage = DRIVE
  await shown()
  await fireEvent.press(screen.getByTestId('move-bucket'))
  expect(
    screen.getByText('Both strings are needed: the key ID and the application key.'),
  ).toBeTruthy()
  expect(mockStart).not.toHaveBeenCalled()

  await fireEvent.changeText(screen.getByTestId('move-key-id'), '004abc')
  await fireEvent.changeText(screen.getByTestId('move-application-key'), 'K004')
  await act(async () => {
    await fireEvent.press(screen.getByTestId('move-bucket'))
    await Promise.resolve()
  })
  expect(mockStart).toHaveBeenCalledWith(expect.anything(), {
    backblaze: { keyId: '004abc', applicationKey: 'K004' },
  })
  expect(await screen.findByTestId('move-done')).toBeTruthy()
})

it('offers a move left unfinished again, or not at all', async () => {
  mockMoving = DRIVE
  await shown()
  expect(screen.getByTestId('move-unfinished')).toBeTruthy()
  expect(screen.getByTestId('move-continue')).toBeTruthy()

  await act(async () => {
    await fireEvent.press(screen.getByTestId('move-give-up'))
    await Promise.resolve()
  })
  expect(mockStop).toHaveBeenCalled()
  expect(await screen.findByTestId('move-drive')).toBeTruthy()
})

it('keeps a move that failed to be taken up again, saying why', async () => {
  mockMoving = DRIVE
  mockRun = () => Promise.reject(new Error('Your Google storage is full.'))
  await shown()
  await act(async () => {
    await fireEvent.press(screen.getByTestId('move-continue'))
    await Promise.resolve()
  })
  expect(await screen.findByText('Your Google storage is full.')).toBeTruthy()
  expect(screen.getByTestId('move-continue')).toBeTruthy()
})

it('stops when asked, leaving the move to be continued', async () => {
  mockMoving = DRIVE
  let stopped: () => boolean = () => false
  let end: (finished: boolean) => void = () => undefined
  mockRun = options => {
    stopped = options.stopped
    return new Promise(resolve => {
      end = resolve
    })
  }
  await shown()
  await act(async () => {
    await fireEvent.press(screen.getByTestId('move-continue'))
    await Promise.resolve()
  })
  await fireEvent.press(screen.getByTestId('move-stop'))
  expect(stopped()).toBe(true)
  await act(async () => {
    end(false)
    await Promise.resolve()
  })
  expect(screen.getByTestId('move-continue')).toBeTruthy()
})
