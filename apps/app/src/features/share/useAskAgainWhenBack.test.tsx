import { renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import type { NetworkStateEvent } from 'expo-network'
import { useAskAgainWhenBack } from './useAskAgainWhenBack'

/** expo-network's listeners: a phone's network changes, or a browser's online and offline. */
const mockNetwork: ((event: NetworkStateEvent) => void)[] = []
jest.mock('expo-network', () => ({
  addNetworkStateListener: (listener: (event: NetworkStateEvent) => void) => {
    mockNetwork.push(listener)
    return { remove: () => mockNetwork.splice(mockNetwork.indexOf(listener), 1) }
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
  it('is asked for again when the network is back, not when it goes', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    network(false)
    expect(ask).not.toHaveBeenCalled()
    network(true)
    expect(ask).toHaveBeenCalledTimes(1)
    // A phone that cannot yet say whether the internet is there is connected.
    network(true, undefined)
    expect(ask).toHaveBeenCalledTimes(2)
    // On a network that reaches nothing, asking would only fail again.
    network(true, false)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('is asked for again when the app comes back to the front', async () => {
    const ask = jest.fn()
    await renderHook(() => useAskAgainWhenBack(true, ask))
    moveTo('background')
    expect(ask).not.toHaveBeenCalled()
    moveTo('active')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('is not asked for again once it is shown, or after the page has gone', async () => {
    const ask = jest.fn()
    const page = await renderHook(
      ({ waiting }: { waiting: boolean }) => useAskAgainWhenBack(waiting, ask),
      {
        initialProps: { waiting: true },
      },
    )
    await page.rerender({ waiting: false })
    network(true)
    moveTo('active')
    expect(ask).not.toHaveBeenCalled()

    await page.rerender({ waiting: true })
    await page.unmount()
    network(true)
    moveTo('active')
    expect(ask).not.toHaveBeenCalled()
  })
})
