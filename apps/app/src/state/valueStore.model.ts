/**
 * The smallest external store, for a value that lives outside React and is
 * read through `useSyncExternalStore` (`useValueStore`): the player's fast
 * facts, and the shell's one-flag stores whose writer and reader are not each
 * other's parent.
 *
 * Pure, so vitest runs it: no React.
 */

export interface ValueStore<T> {
  get: () => T
  /** Replaces the value, and tells subscribers only when it actually changed. */
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * The smallest external store: a value, and who to tell when it changes.
 * `equal` decides "changed", so an object rebuilt with the same fields is not
 * a change and wakes nobody.
 */
export function createValueStore<T>(
  initial: T,
  equal: (a: T, b: T) => boolean = Object.is,
): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      if (equal(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
