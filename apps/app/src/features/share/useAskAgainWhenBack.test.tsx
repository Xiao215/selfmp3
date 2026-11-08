import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import type { NetworkStateEvent } from 'expo-network'
import { networkBackWatch, useAskAgainWhenBack } from './useAskAgainWhenBack'

/**
 * expo-network's listeners: a phone's network changes, or a browser's online
 * and offline. A phone sends its state when it is first listened to, and
 * Android again on every change to the network's capabilities, connected or
 * not — so a listener hears "connected" many times over. Every watch made in
 * this file stays listening, as the app's own does.
 */
const mockNetwork: ((event: NetworkStateEvent) => void)[] = []
const mockWatch = { added: 0, removed: 0 }
/** What the network is as it is first asked. */
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

describe('the network coming back', () => {
  it('is not the state a phone sends as it is first listened to', () => {
    const back = jest.fn()
    networkBackWatch()(back)
    network(true)
    expect(back).not.toHaveBeenCalled()
  })

  it('is not the network staying connected', () => {
    const back = jest.fn()
    networkBackWatch()(back)
    network(true)
    network(true)
    network(true, undefined)
    expect(back).not.toHaveBeenCalled()
  })

  it('is heard once each time the network comes back', () => {
    const back = jest.fn()
    networkBackWatch()(back)
    network(false)
    expect(back).not.toHaveBeenCalled()
    network(true)
    network(true)
    expect(back).toHaveBeenCalledTimes(1)
    // A phone that cannot yet say whether the internet is there is connected.
    network(false)
    network(true, undefined)
    expect(back).toHaveBeenCalledTimes(2)
    // On a network that reaches nothing, asking would only fail again.
    network(false)
    network(true, false)
    expect(back).toHaveBeenCalledTimes(2)
  })

  it('is heard by a browser opened offline, which says nothing until it is back', async () => {
    mockNow.isConnected = false
    mockNow.isInternetReachable = false
    const back = jest.fn()
    networkBackWatch()(back)
    await act(() => Promise.resolve())
    network(true)
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('is watched once, never let go, and heard by whoever listens now', () => {
    const before = { ...mockWatch }
    const hear = networkBackWatch()
    const first = jest.fn()
    const next = jest.fn()
    const stopFirst = hear(first)
    network(false)
    stopFirst()
    hear(next)
    network(true)
    expect(first).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    // On iOS a watch let go of never starts again.
    expect(mockWatch).toEqual({ added: before.added + 1, removed: before.removed })
  })
})

describe('a link that could not be reached', () => {
  it('is asked for again when the network comes back', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    network(false)
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

  it('is asked for again once its ask fails, when the network came back during it', async () => {
    const ask = jest.fn()
    const page = await renderHook(
      ({ waiting }: { waiting: boolean }) => useAskAgainWhenBack(waiting, ask),
      { initialProps: { waiting: true } },
    )
    network(false)
    // Asked for: not waiting while it is asked, waiting again when it fails.
    await page.rerender({ waiting: false })
    network(true)
    moveTo('active')
    expect(ask).not.toHaveBeenCalled()
    await page.rerender({ waiting: true })
    expect(ask).toHaveBeenCalledTimes(1)
    await page.rerender({ waiting: false })
    await page.rerender({ waiting: true })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('is heard on the next page once the first has gone, which hears nothing more', async () => {
    const removed = mockWatch.removed
    const first = jest.fn()
    const firstPage = await renderHook(() => useAskAgainWhenBack(true, first))
    network(false)
    await firstPage.unmount()
    expect(watching).toHaveLength(0)

    const next = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, next))
    network(true)
    expect(first).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    expect(mockWatch.removed).toBe(removed)
  })
})
