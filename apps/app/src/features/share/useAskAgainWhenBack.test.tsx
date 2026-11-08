import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import type { NetworkStateEvent } from 'expo-network'
import { useAskAgainWhenBack } from './useAskAgainWhenBack'

/**
 * expo-network's listeners: a phone's network changes, or a browser's online
 * and offline. A phone sends its state as soon as it is listened to, and
 * Android again on every change to the network's capabilities, connected or
 * not — so a listener hears "connected" many times over.
 */
const mockNetwork: ((event: NetworkStateEvent) => void)[] = []
const mockWatch = { added: 0, removed: 0 }
/** What the network is as it is first asked; a phone also sends it to a new listener. */
const mockNow = { isConnected: true, isInternetReachable: true }
jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => Promise.resolve({ ...mockNow }),
  addNetworkStateListener: (listener: (event: NetworkStateEvent) => void) => {
    mockNetwork.push(listener)
    mockWatch.added++
    return {
      remove: () => {
        mockWatch.removed++
        mockNetwork.splice(mockNetwork.indexOf(listener), 1)
      },
    }
  },
}))
const network = (isConnected: boolean, isInternetReachable: boolean | undefined = isConnected) => {
  for (const listener of [...mockNetwork]) listener({ isConnected, isInternetReachable })
}

let watching: ((state: AppStateStatus) => void)[]
const moveTo = (state: AppStateStatus) => {
  for (const handler of [...watching]) handler(state)
}

beforeEach(() => {
  mockNetwork.length = 0
  mockWatch.added = 0
  mockWatch.removed = 0
  mockNow.isConnected = true
  mockNow.isInternetReachable = true
  watching = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const each = handler as (state: AppStateStatus) => void
    watching.push(each)
    return {
      remove: () => {
        watching = watching.filter(other => other !== each)
      },
    } as ReturnType<typeof AppState.addEventListener>
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a link that could not be reached', () => {
  it('is not asked for again on the state a phone sends as it is listened to', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    network(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('is not asked for again while the network stays connected', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    network(true)
    network(true)
    network(true, undefined)
    expect(ask).not.toHaveBeenCalled()
  })

  it('is asked for again once when the network comes back', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    network(false)
    expect(ask).not.toHaveBeenCalled()
    network(true)
    network(true)
    expect(ask).toHaveBeenCalledTimes(1)
    // A phone that cannot yet say whether the internet is there is connected.
    network(false)
    network(true, undefined)
    expect(ask).toHaveBeenCalledTimes(2)
    // On a network that reaches nothing, asking would only fail again.
    network(false)
    network(true, false)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('is asked for again when a browser opened offline says it is back', async () => {
    mockNow.isConnected = false
    mockNow.isInternetReachable = false
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    await act(() => Promise.resolve())
    network(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('is asked for again when the app comes back to the front', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    moveTo('background')
    expect(ask).not.toHaveBeenCalled()
    moveTo('active')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('is not asked for again once it is shown, nor its watch made again around each ask', async () => {
    const ask = jest.fn()
    const page = await renderHook(
      ({ waiting }: { waiting: boolean }) => useAskAgainWhenBack(waiting, ask),
      { initialProps: { waiting: true } },
    )
    network(false)
    // Asking again: not waiting while it is asked, waiting again when it fails.
    await page.rerender({ waiting: false })
    network(true)
    moveTo('active')
    expect(ask).not.toHaveBeenCalled()
    await page.rerender({ waiting: true })
    expect(mockWatch).toEqual({ added: 1, removed: 0 })
  })

  it('stops listening once the page has gone', async () => {
    const ask = jest.fn()
    const page = await renderHook(() => useAskAgainWhenBack(true, ask))
    network(false)
    await page.unmount()
    expect(mockWatch).toEqual({ added: 1, removed: 1 })
    expect(watching).toHaveLength(0)
    network(true)
    moveTo('active')
    expect(ask).not.toHaveBeenCalled()
  })
})
