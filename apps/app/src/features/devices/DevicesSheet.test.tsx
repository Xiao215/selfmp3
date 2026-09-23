import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Device, PlaybackState } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { DevicesSheet } from './DevicesSheet'

const mockPlayHere = jest.fn()
const mockPlayOn = jest.fn()

let mockContext: Record<string, unknown>

jest.mock('./DevicesProvider', () => ({
  useDeviceContext: () => mockContext,
}))
jest.mock('../../player/PlayerProvider', () => ({
  usePlayer: () => ({ current: { id: 4, title: 'Nocturne' } }),
}))
jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, finePointer: false }),
}))

function state(patch: Partial<PlaybackState> = {}): PlaybackState {
  return {
    songId: 7,
    position: 30,
    playing: true,
    queueIds: [7],
    queueIndex: 0,
    shuffle: false,
    repeat: 'off',
    updatedAt: Date.now(),
    ...patch,
  }
}

function device(patch: Partial<Device> = {}): Device {
  return {
    id: 'other-device-1',
    name: 'iPhone · Safari',
    kind: 'phone',
    state: state(),
    lastSeenAt: Date.now(),
    online: true,
    ...patch,
  }
}

function base(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: 'this-device-1',
    name: 'Mac · Chrome',
    rename: jest.fn(),
    devices: [],
    others: [],
    connected: true,
    playingElsewhere: null,
    reach: null,
    canPlayOn: true,
    send: () => true,
    playHere: mockPlayHere,
    playOn: mockPlayOn,
    ...patch,
  }
}

/**
 * A `Sheet` draws through the shell's overlay host and asks the window for its
 * insets, so both have to be standing for it to be on screen at all.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const draw = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OverlayProvider>
        <DevicesSheet open onClose={() => undefined} />
      </OverlayProvider>
    </SafeAreaProvider>,
  )

/**
 * What the devices list says on a device whose library is the bucket's.
 *
 * Presence is the one thing here that really does need the server awake — a
 * bucket cannot hold a connection open between two devices — so the interesting
 * cases are all the ones where something cannot be done, and whether the sheet
 * says so or quietly draws nothing.
 */
describe('DevicesSheet from a cloud library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockContext = base()
  })

  it('says why there is no list when the server is not answering', async () => {
    mockContext = base({ reach: { state: 'away', said: true, lookAgain: () => undefined } })
    await draw()

    expect(screen.getByTestId('devices-server-away')).toBeTruthy()
    expect(screen.getByText('Your server isn’t answering')).toBeTruthy()
    expect(screen.getByText(/Your devices find each other through your server/)).toBeTruthy()
  })

  it('keeps looking, and says that, before it has an answer', async () => {
    mockContext = base({ reach: { state: 'looking', lookAgain: () => undefined } })
    await draw()

    expect(screen.getByTestId('devices-server-looking')).toBeTruthy()
  })

  it('lists the other devices once the server is in reach', async () => {
    mockContext = base({
      reach: { state: 'reachable', connection: { baseUrl: 'http://x', token: null } },
      others: [device()],
    })
    await draw()

    expect(screen.queryByTestId('devices-server-away')).toBeNull()
    expect(screen.getByTestId('device-other-device-1')).toBeTruthy()
    expect(screen.getByText('Playing now')).toBeTruthy()
  })

  /*
   * The translation failing is not a reason to draw nothing. A song this
   * library has no number for comes through with `songId: null`, and the row
   * has to say that rather than offer a handoff that would silently do nothing
   * — or, worse, land on whatever song happened to hold that number here.
   */
  it('draws a device playing something it cannot name, and refuses to take it over', async () => {
    mockContext = base({ others: [device({ state: state({ songId: null, queueIds: [] }) })] })
    await draw()

    expect(screen.getByText('Playing something not in your bucket')).toBeTruthy()
    const row = screen.getByRole('menuitem', { name: /iPhone/ })
    expect(row).toBeDisabled()
    await fireEvent.press(row)
    expect(mockPlayHere).not.toHaveBeenCalled()
  })

  it('offers to push to another device only when this song can be named there', async () => {
    mockContext = base({ others: [device()], canPlayOn: false })
    await draw()

    expect(
      screen.getByText('This song isn’t in your bucket yet, so no other device can find it.'),
    ).toBeTruthy()
    const push = screen.getByRole('menuitem', { name: 'Play there instead' })
    expect(push).toBeDisabled()
    await fireEvent.press(push)
    expect(mockPlayOn).not.toHaveBeenCalled()
  })
})
