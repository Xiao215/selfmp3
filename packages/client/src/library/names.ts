/**
 * A name nothing else has yet: `base` itself while it is free, then `base 2`,
 * `base 3`… — how a new playlist, or a copy of one, is named beside the ones
 * already there.
 */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
