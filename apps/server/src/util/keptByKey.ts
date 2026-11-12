/**
 * What `make` returns, made once for each `key` and handed out again until
 * the key moves. The key names what it is made from, so a kept one is not
 * stale. Callers share the one value, so they read it and never change it.
 */
export function keptByKey<T>(key: () => string, make: () => T): () => T {
  let kept: { key: string; value: T } | null = null
  return () => {
    const current = key()
    if (kept?.key !== current) kept = { key: current, value: make() }
    return kept.value
  }
}
