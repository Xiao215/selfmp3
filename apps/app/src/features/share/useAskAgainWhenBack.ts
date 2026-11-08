import { useEffect, useEffectEvent, useRef } from 'react'
import { AppState } from 'react-native'
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network'

/**
 * While `waiting`, `ask` again when the network comes back, or the app comes
 * back to the front: a link that could not be reached opens by itself.
 *
 * Not the queries' own refetch on reconnect: they hear the network only once
 * told of a change, and a page opened with no network has them think they
 * were online all along. Nor `useOnline`, which on a phone hears nothing at
 * all. expo-network hears a phone's network, and a browser's online and
 * offline; coming back to the front is when a phone that changed networks in
 * the background is likely looked at again.
 *
 * Listened to for as long as the page is open, and only a change from not
 * connected to connected asks: a phone sends its state as soon as it is
 * listened to, and Android again on every change to the network's
 * capabilities. Listening anew around each ask heard "connected" at once and
 * asked again, on and on, while the doorman kept failing.
 */
export function useAskAgainWhenBack(waiting: boolean, ask: () => void): void {
  const askIfWaiting = useEffectEvent(() => {
    if (waiting) ask()
  })
  // Unknown until the first state is heard, which is never a change.
  const connected = useRef<boolean | null>(null)
  useEffect(() => {
    const network = addNetworkStateListener(state => {
      const now = isConnected(state)
      const back = connected.current === false && now
      connected.current = now
      if (back) askIfWaiting()
    })
    // A browser says nothing as it is listened to: opened offline, the first
    // it says is that the network is back.
    void getNetworkStateAsync()
      .then(state => {
        connected.current ??= isConnected(state)
      })
      .catch(() => undefined)
    const front = AppState.addEventListener('change', state => {
      if (state === 'active') askIfWaiting()
    })
    return () => {
      network.remove()
      front.remove()
    }
  }, [])
}

function isConnected({ isConnected, isInternetReachable }: Partial<NetworkState>): boolean {
  // Reachable is unknown on a phone for a moment after it connects.
  return isConnected === true && isInternetReachable !== false
}
