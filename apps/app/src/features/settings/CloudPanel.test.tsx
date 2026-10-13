import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { CloudStatus } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { CloudPanel } from './CloudPanel'

/**
 * Settings › Cloud, signed in with no bucket yet: the bucket form. Signing
 * this server out asks first, as it does once a bucket is connected, and the
 * form takes no typing while the key it was given is being tried.
 */

const mockDisconnect = { mutate: jest.fn(), isPending: false }
const mockConnect = { mutate: jest.fn(), isPending: false, error: null as Error | null }
const mockIdle = {
  mutate: jest.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
}

const mockSignedIn: CloudStatus = {
  doormanUrl: 'https://doorman.example',
  account: { email: 'me@example.com' },
  signingIn: false,
  signInNeedsCode: false,
  connected: false,
  target: null,
  deviceId: null,
  state: 'off',
  progress: null,
  songs: { total: 0, inCloud: 0 },
  bytesInCloud: 0,
  lastSyncAt: null,
  lastSnapshotAt: null,
  lastError: null,
} as unknown as CloudStatus

jest.mock('../../ports/signInReturn', () => ({
  onSignInCode: () => () => undefined,
  signInReturnUrl: () => 'selfmp3://settings',
}))
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useCloudStatus: () => ({ data: mockSignedIn, error: null }),
  useCloudConnect: () => mockConnect,
  useCloudConnectStorage: () => mockConnect,
  useCloudDisconnect: () => mockDisconnect,
  useCloudSync: () => mockIdle,
  useCloudSignIn: () => mockIdle,
  useCloudCancelSignIn: () => mockIdle,
  useCloudEnterCode: () => mockIdle,
}))

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/** The panel inside what draws its dialogs. */
const draw = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OverlayProvider>
        <CloudPanel anchor={() => undefined} />
      </OverlayProvider>
    </SafeAreaProvider>,
  )

describe('the bucket form, signed in', () => {
  beforeEach(() => {
    mockDisconnect.mutate.mockClear()
    mockConnect.isPending = false
  })

  it('asks before it signs this server out', async () => {
    await draw()
    await fireEvent.press(screen.getByTestId('cloud-form-sign-out'))
    expect(mockDisconnect.mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Sign this server out of me@example.com?')).toBeTruthy()

    await fireEvent.press(screen.getAllByText('Sign out').at(-1)!)
    expect(mockDisconnect.mutate).toHaveBeenCalledTimes(1)
  })

  it('takes no typing while the key is being tried', async () => {
    mockConnect.isPending = true
    await draw()
    expect(screen.getByTestId('cloud-address-endpoint').props['editable']).toBe(false)
    expect(screen.getByText('Checking the bucket…')).toBeTruthy()
  })
})
