import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { meteredConnections } from '../ports/metered'
// Imported lazily, and never at module scope. `expo-network` is a native
// module, so on a binary built before it was added — which is every binary
// until the next `expo run:ios` — touching it throws "Cannot find native
// module 'ExpoNetwork'". At module scope that takes the screen down with it:
// a route fails to export, and the error boundary itself is undefined by the
// time anything tries to catch it. Knowing the connection is a nicety; the
// app running is not.
type NetworkModule = {
  getNetworkStateAsync: () => Promise<{ isConnected?: boolean; type?: string }>
  NetworkStateType: Record<string, string>
}

function networkModule(): NetworkModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-network') as NetworkModule
  } catch {
    return null
  }
}

/**
 * What this phone is connected through, so downloading can care.
 *
 * A library is measured in gigabytes and a phone plan is not. Downloading
 * thirteen songs over somebody's data allowance because they opened the app on
 * a train is the kind of thing an app only gets to do once.
 *
 * Deliberately not a subscription. `expo-network` can push changes, but the
 * only moments that matter here are when the app comes to the front and when
 * someone is about to start a download — and asking then is both simpler and
 * impossible to leave stale.
 */

type ConnectionKind = 'wifi' | 'cellular' | 'none' | 'unknown'

export async function connectionKind(): Promise<ConnectionKind> {
  /*
   * A computer's connection is never metered, as far as this app is concerned
   * (decided 2026-09-12). Wired, Wi-Fi at a desk, a laptop tethered — none of
   * them is the train the 500 MB question exists for, and `expo-network` in a
   * browser build cannot tell them apart anyway. Asked through a port rather
   * than by looking at the platform.
   */
  if (!meteredConnections) return 'wifi'
  try {
    const network = networkModule()
    if (!network) return 'unknown'
    const state = await network.getNetworkStateAsync()
    if (state.isConnected === false) return 'none'
    const kinds = network.NetworkStateType
    switch (state.type) {
      case kinds['WIFI']:
      case kinds['ETHERNET']:
        return 'wifi'
      case kinds['CELLULAR']:
        return 'cellular'
      case kinds['NONE']:
        return 'none'
      default:
        // A simulator, a VPN, something the OS will not name. Treated as
        // unknown rather than as cellular: refusing to download on a desk is
        // worse than the data it might have cost, and this is also every
        // simulator, where the whole app would otherwise look broken.
        return 'unknown'
    }
  } catch {
    return 'unknown'
  }
}

/** The current connection, refreshed whenever the app comes back to the front. */
export function useConnectionKind(): ConnectionKind {
  const [kind, setKind] = useState<ConnectionKind>('unknown')

  useEffect(() => {
    let cancelled = false
    const look = (): void => {
      void connectionKind().then(next => {
        if (!cancelled) setKind(next)
      })
    }
    // Off the effect body: setting state synchronously here is a cascading
    // render, and the answer is never needed in the first frame.
    const first = setTimeout(look, 0)
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') look()
    })
    return () => {
      cancelled = true
      clearTimeout(first)
      sub.remove()
    }
  }, [])

  return kind
}
