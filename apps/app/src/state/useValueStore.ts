import { useSyncExternalStore } from 'react'

import type { ValueStore } from './valueStore.model'

/** A value store's value, rendering again only when it changes. */
export function useValueStore<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
