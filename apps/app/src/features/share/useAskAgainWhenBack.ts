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
 * Only a change from not connected to connected asks: a phone sends its
 * state when it is first listened to, and Android again on every change to
 * the network's capabilities. A change heard while the link is being asked
 * for is kept, and asked for once that ask has failed.
 */
export function useAskAgainWhenBack(waiting: boolean, ask: () => void): void {
  const missedBack = useRef(false)
  const askNow = useEffectEvent(ask)
  const back = useEffectEvent(() => {
    if (waiting) ask()
    else missedBack.current = true
  })
  const front = useEffectEvent(() => {
    if (waiting) ask()
  })
  useEffect(() => {
    const stopHearing = hearBack(back)
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') front()
    })
    return () => {
      stopHearing()
      app.remove()
    }
  }, [])
  useEffect(() => {
    if (!waiting || !missedBack.current) return
    missedBack.current = false
    askNow()
  }, [waiting])
}

/**
 * Hearing the network come back, watched once and never let go: on iOS,
 * expo-network's one path monitor stops for good once its last listener is
 * removed, and every page after the first heard nothing. One for the app
 * (`hearBack`); exported so a test can make a fresh one.
 */
export function networkBackWatch(): (listener: () => void) => () => void {
  let connected: boolean | null = null
  let watching = false
  const listeners = new Set<() => void>()
  return listener => {
    if (!watching) {
      watching = true
      addNetworkStateListener(state => {
        const now = isConnected(state)
        const back = connected === false && now
        connected = now
        if (back) for (const each of [...listeners]) each()
      })
      // A browser says nothing as it is listened to: opened offline, the
      // first it says is that the network is back.
      void getNetworkStateAsync()
        .then(state => {
          connected ??= isConnected(state)
        })
        .catch(() => undefined)
    }
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}

const hearBack = networkBackWatch()

function isConnected({ isConnected, isInternetReachable }: Partial<NetworkState>): boolean {
  // Reachable is unknown on a phone for a moment after it connects.
  return isConnected === true && isInternetReachable !== false
}
