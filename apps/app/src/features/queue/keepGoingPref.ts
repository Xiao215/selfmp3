import { prefs } from '../../ports/prefs'
import { createValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'

/**
 * Keep going's switch (docs/features/lists.md): a preference of this device,
 * as Auto-mix is, and off until it is turned on. Off, a song played on its
 * own ends with its end card, as it always has (A1, 2026-10-08).
 */

const KEY = 'keepGoing'

const store = createValueStore(prefs.get(KEY) === '1')

export function setKeepGoing(on: boolean): void {
  prefs.set(KEY, on ? '1' : '0')
  store.set(on)
}

/** Whether Up next carries on with songs like the last ones when it runs out. */
export function useKeepGoingOn(): boolean {
  return useValueStore(store)
}
