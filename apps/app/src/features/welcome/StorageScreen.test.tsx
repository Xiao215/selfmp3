import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { DriveBack } from '@selfmp3/shared'

import { StorageScreen } from './StorageScreen'

/**
 * Where it lives, on its way to Google Drive: the page leaves for Google with
 * the address to come back to, goes on only once the doorman says the storage
 * is there, and says why when Google's page ended some other way.
 */

const SESSION = { doormanUrl: 'https://doorman.test', token: 't', me: { storage: null } }
const DRIVE = { kind: 'drive' as const, folder: '1AbC' }

const mockBegin = jest.fn((..._args: unknown[]) => Promise.resolve())
const mockRefresh = jest.fn((): Promise<{ me: { storage: typeof DRIVE | null } }> =>
  Promise.resolve({ ...SESSION, me: { storage: DRIVE } }),
)
const mockBackblaze = jest.fn()
jest.mock('../../replica', () => ({
  session: {
    loadSession: () => Promise.resolve(SESSION),
    refreshSession: () => mockRefresh(),
    beginDriveConnect: (...args: unknown[]) => mockBegin(...args),
    connectBackblaze: () => mockBackblaze(),
  },
}))
let mockBack: (back: DriveBack) => void = () => undefined
jest.mock('../../ports/signInReturn', () => ({
  signInReturnUrl: (target: string) => `selfmp3://${target}`,
  onSignInBack: (_target: string, listener: (back: DriveBack) => void) => {
    mockBack = listener
    return () => undefined
  },
}))
const mockConnected = jest.fn()
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ storageConnected: mockConnected }),
}))
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('../profile/useCloudSession', () => ({
  useCloudSession: () => ({ data: { email: 'me@example.com' } }),
}))
jest.mock('../settings/SignOutDialog', () => ({ SignOutDialog: () => null }))
jest.mock('./firstSyncMemory', () => ({ storedFirstSync: () => null }))
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
      <StorageScreen />
    </SafeAreaProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('opens on Google Drive, with no key to paste', async () => {
  await shown()
  expect(screen.getByTestId('storage-drive')).toBeTruthy()
  expect(screen.queryByTestId('storage-key-id')).toBeNull()
})

it('leaves for Google with the way back, and goes on once Drive is connected', async () => {
  await shown()
  await fireEvent.press(screen.getByTestId('storage-drive'))
  expect(mockBegin).toHaveBeenCalledWith(SESSION, 'selfmp3://storage')
  expect(screen.getByText('Waiting for Google. Finish there, then come back here.')).toBeTruthy()
  expect(mockConnected).not.toHaveBeenCalled()

  await act(async () => {
    mockBack({ kind: 'connected' })
  })
  expect(mockRefresh).toHaveBeenCalled()
  expect(mockConnected).toHaveBeenCalledTimes(1)
  expect(mockReplace).toHaveBeenCalledTimes(1)
})

it('asks again while the doorman has not heard yet, and goes on once', async () => {
  jest.useFakeTimers()
  try {
    mockRefresh.mockImplementationOnce(() => Promise.resolve({ ...SESSION, me: { storage: null } }))
    await shown()
    await fireEvent.press(screen.getByTestId('storage-drive'))
    await act(async () => {
      mockBack({ kind: 'connected' })
    })
    expect(mockConnected).not.toHaveBeenCalled()
    expect(screen.getByText('Google said yes. Finding your storage…')).toBeTruthy()

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000)
    })
    expect(mockRefresh).toHaveBeenCalledTimes(2)
    // The same link arriving again changes nothing.
    await act(async () => {
      mockBack({ kind: 'connected' })
    })
    expect(mockConnected).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledTimes(1)
  } finally {
    jest.useRealTimers()
  }
})

it('opens Google once, however fast the button is pressed twice', async () => {
  await shown()
  const button = screen.getByTestId('storage-drive')
  await act(async () => {
    await Promise.all([fireEvent.press(button), fireEvent.press(button)])
  })
  expect(mockBegin).toHaveBeenCalledTimes(1)
})

it('says why, and stays, when the Drive box was left unticked', async () => {
  await shown()
  await fireEvent.press(screen.getByTestId('storage-drive'))
  await act(async () => {
    mockBack({ kind: 'refused', refusal: 'unticked' })
  })
  expect(screen.getByText(/Tick the one that lets self\.mp3 keep its own files/)).toBeTruthy()
  expect(screen.getByText('Use Google Drive')).toBeTruthy()
  expect(mockConnected).not.toHaveBeenCalled()
})

it('says so when Google could not be opened', async () => {
  mockBegin.mockImplementationOnce(() => Promise.reject(new Error('The sign-in service is busy.')))
  await shown()
  await fireEvent.press(screen.getByTestId('storage-drive'))
  await act(async () => undefined)
  expect(screen.getByText('The sign-in service is busy.')).toBeTruthy()
  expect(screen.getByText('Use Google Drive')).toBeTruthy()
})

it('still offers a bucket of your own, and the way back to Drive', async () => {
  await shown()
  await fireEvent.press(screen.getByTestId('storage-kind'))
  expect(screen.getByTestId('storage-key-id')).toBeTruthy()
  expect(screen.getByTestId('storage-connect')).toBeTruthy()
  await fireEvent.press(screen.getByTestId('storage-kind'))
  expect(screen.getByTestId('storage-drive')).toBeTruthy()
})
