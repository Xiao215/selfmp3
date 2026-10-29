import { useEffect } from 'react'
import { act, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, configureClient, type Api } from '@selfmp3/client'
import type { Device, DeviceCommand } from '@selfmp3/shared'

import { currentToasts, dismissToast } from '../../ui/toast'
import { DevicesProvider, useDeviceContext } from './DevicesProvider'

const mockToggle = jest.fn()
const mockPlayer = {
  current: { id: 4, title: 'Nocturne' },
  isPlaying: true,
  queue: { items: [4], index: 0, shuffle: false, repeat: 'off' },
  getPosition: () => 30,
  subscribeProgress: () => () => undefined,
  toggle: mockToggle,
  playFrom: jest.fn(),
}

jest.mock('../../player/PlayerProvider', () => ({ usePlayer: () => mockPlayer }))
// A device with its own server: no ids to translate.
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false }),
}))
jest.mock('./usePresenceServer', () => {
  const presence = { connection: { baseUrl: 'http://server.test' }, reach: null }
  return { usePresenceServer: () => presence }
})
jest.mock('../../connection/useServerSongIds', () => {
  const ids = { onServer: () => undefined, onDevice: () => undefined }
  return { useServerSongIds: () => ids }
})
jest.mock('../../ports/events', () => ({ serverEvents: { open: () => () => undefined } }))
jest.mock('../../ports/device', () => ({
  ...jest.requireActual('../../ports/device'),
  deviceKind: () => 'desktop',
  getDeviceName: () => 'Mac · Chrome',
  presenceDeviceId: () => 'this-device',
  presenceDeviceName: (name: string) => name,
  setDeviceName: (name: string) => name,
}))

const deviceCommand = jest.fn<Promise<unknown>, [string, DeviceCommand]>()
configureClient({
  api: {
    devices: async () => ({ devices: [], now: Date.now() }),
    heartbeat: async () => ({ devices: [], now: Date.now() }),
    deviceCommand,
  } as unknown as Api,
})

const kitchen: Device = {
  id: 'kitchen-tab',
  name: 'Kitchen',
  kind: 'desktop',
  state: {
    songId: null,
    position: 0,
    playing: false,
    queueIds: [],
    queueIndex: -1,
    shuffle: false,
    repeat: 'off',
    updatedAt: Date.now(),
  },
  lastSeenAt: Date.now(),
  online: true,
}

const seen: { current: ReturnType<typeof useDeviceContext> | null } = { current: null }
function Reader(): null {
  const context = useDeviceContext()
  useEffect(() => {
    seen.current = context
  })
  return null
}

async function renderProvider(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  await render(
    <QueryClientProvider client={client}>
      <DevicesProvider>
        <Reader />
      </DevicesProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockToggle.mockClear()
  deviceCommand.mockReset()
  for (const toast of currentToasts()) dismissToast(toast.id)
})

describe('Play there instead', () => {
  it('stops here once the other device has the song', async () => {
    deviceCommand.mockResolvedValue({ ok: true, delivered: 1 })
    await renderProvider()
    await act(async () => {
      await seen.current?.playOn(kitchen)
    })
    expect(deviceCommand).toHaveBeenCalledWith(
      'kitchen-tab',
      expect.objectContaining({ type: 'playSong', songId: 4, position: 30 }),
    )
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('keeps playing here, and says so, when the device has just gone (R3-M6)', async () => {
    deviceCommand.mockRejectedValue(
      new ApiError(409, 'that device is not connected right now', 'device_offline'),
    )
    await renderProvider()
    await act(async () => {
      await seen.current?.playOn(kitchen)
    })
    expect(mockToggle).not.toHaveBeenCalled()
    expect(currentToasts()).toEqual([
      expect.objectContaining({
        say: 'Kitchen',
        over: 'Isn’t connected any more',
        under: 'Still playing here.',
      }),
    ])
  })

  it('keeps playing here when the server could not be reached', async () => {
    deviceCommand.mockRejectedValue(new ApiError(0, 'offline'))
    await renderProvider()
    await act(async () => {
      await seen.current?.playOn(kitchen)
    })
    expect(mockToggle).not.toHaveBeenCalled()
    expect(currentToasts()).toEqual([
      expect.objectContaining({ say: 'Couldn’t play on Kitchen', tone: 'error' }),
    ])
  })
})
