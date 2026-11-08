/**
 * What this tab keeps across a reload and a restored session, and nothing
 * longer: its `sessionStorage`. Without one (blocked storage) it keeps nothing.
 */
export function readTabSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeTabSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // As above.
  }
}
