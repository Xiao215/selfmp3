import { useEffect, useState } from 'react'

/**
 * `value`, once it has stopped changing for `delayMs`.
 *
 * For work that should follow typing rather than keep up with it — a preview
 * request, a save — so three keystrokes are one request, not three.
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
