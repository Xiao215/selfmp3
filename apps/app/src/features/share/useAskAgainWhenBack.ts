import { useEffect, useEffectEvent } from 'react'
import { AppState } from 'react-native'
import { addNetworkStateListener } from 'expo-network'

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
 */
export function useAskAgainWhenBack(waiting: boolean, ask: () => void): void {
  const askNow = useEffectEvent(ask)
  useEffect(() => {
    if (!waiting) return undefined
    const network = addNetworkStateListener(({ isConnected, isInternetReachable }) => {
      // Reachable is unknown on a phone for a moment after it connects.
      if (isConnected && isInternetReachable !== false) askNow()
    })
    const front = AppState.addEventListener('change', state => {
      if (state === 'active') askNow()
    })
    return () => {
      network.remove()
      front.remove()
    }
  }, [waiting])
}
