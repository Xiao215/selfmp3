/**
 * Small text and list helpers the smart features share: one copy each, so two
 * features never disagree about what "the same name" means.
 */

/** Letters and digits only, lower case: "chill · chinese · hype" and "chill chinese hype" are one. */
export function bare(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** `bare`, with widths and accents folded too: "Ｌｉｙｕｅ" and "liyue", "Frédéric" and "frederic". */
export function foldedBare(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** How often each value comes up, most first, ties alphabetically. */
export function tally(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** The items in runs of `size`, the last one shorter. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
