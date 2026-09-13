/**
 * Songs kept because they were played, on a phone: none.
 *
 * A phone downloads what it keeps on purpose (automatically on Wi-Fi, or by
 * hand) and plays from the files; the budget for played copies is a browser's
 * answer to streaming everything. Every call here does nothing.
 */
export function recentIds(): ReadonlySet<number> {
  return new Set()
}

export function keepRecentlyPlayed(_songId: number): Promise<void> {
  return Promise.resolve()
}

export function forgetRecent(_songIds: readonly number[]): void {}

export function clearRecent(): void {}
