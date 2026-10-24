/** Whether a page can open in a tab of its own: a browser's, not a phone's or the Mac app's. */
export function hasTabs(): boolean {
  return false
}

/**
 * Open a page of this app in a tab of its own, leaving this one where it is.
 * False where there are no tabs — a phone, which opens it in place instead.
 */
export function openInNewTab(_path: string): boolean {
  return false
}
