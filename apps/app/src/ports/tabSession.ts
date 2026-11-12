/**
 * What a browser tab keeps across a reload (`sessionStorage`). An app has no
 * reload: what it keeps lives as long as it is open.
 */
const kept = new Map<string, string>()

export function readTabSession(key: string): string | null {
  return kept.get(key) ?? null
}

export function writeTabSession(key: string, value: string): void {
  kept.set(key, value)
}
