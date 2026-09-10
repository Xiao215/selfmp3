/**
 * Small, dependency-free fuzzy matching.
 *
 * Used for tag pickers and the command palette. A personal library is small
 * enough that scoring every candidate on every keystroke is comfortably fast,
 * which buys us a much better ranking than a plain `includes` filter.
 */

export interface FuzzyMatch<T> {
  readonly item: T
  readonly score: number
  /** True when the query equals the candidate exactly, ignoring case. */
  readonly exact: boolean
}

const SCORE_EXACT = 1000
const SCORE_PREFIX = 800
const SCORE_WORD_PREFIX = 700
const SCORE_SUBSTRING = 600
const SCORE_ACRONYM = 500
const SCORE_SUBSEQUENCE = 300

/**
 * Levenshtein distance with an early bail-out.
 *
 * The `maxDistance` cutoff matters: without it, a long query against a long
 * candidate does O(n*m) work for a result we would discard anyway.
 */
export function editDistance(a: string, b: string, maxDistance = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const insertion = (current[j - 1] ?? 0) + 1
      const deletion = (previous[j] ?? 0) + 1
      const best = Math.min(substitution, insertion, deletion)
      current[j] = best
      if (best < rowMin) rowMin = best
    }
    if (rowMin > maxDistance) return maxDistance + 1
    previous = current
  }
  return previous[b.length] ?? maxDistance + 1
}

/** True when every character of `query` appears in `text`, in order. */
export function isSubsequence(query: string, text: string): boolean {
  if (query.length === 0) return true
  let qi = 0
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++
  }
  return qi === query.length
}

/** Initials of each word: "midnight drive" -> "md". */
function acronym(text: string): string {
  return text
    .split(/[\s\-_/]+/)
    .map(word => word[0] ?? '')
    .join('')
}

/**
 * Score one candidate against a query. Returns null when it does not match at
 * all, which lets callers filter and rank in a single pass.
 */
export function scoreMatch(query: string, candidate: string): number | null {
  const q = query.trim().toLowerCase()
  const c = candidate.toLowerCase()
  if (q.length === 0) return 0
  if (c === q) return SCORE_EXACT
  if (c.startsWith(q)) return SCORE_PREFIX - c.length
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(c)) return SCORE_WORD_PREFIX - c.length
  if (c.includes(q)) return SCORE_SUBSTRING - c.length
  if (acronym(c).startsWith(q)) return SCORE_ACRONYM - c.length
  if (isSubsequence(q, c)) return SCORE_SUBSEQUENCE - c.length

  // Last resort: tolerate typos, but only proportionally to query length.
  const tolerance = q.length >= 6 ? 2 : q.length >= 4 ? 1 : 0
  if (tolerance > 0) {
    const distance = editDistance(q, c, tolerance)
    if (distance <= tolerance) return 200 - distance * 50 - c.length
  }
  return null
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Rank a list best-first. An empty query returns everything in its original
 * order, which is what a picker should show before the user types.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  toText: (item: T) => string,
): FuzzyMatch<T>[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) {
    return items.map(item => ({ item, score: 0, exact: false }))
  }

  const matches: FuzzyMatch<T>[] = []
  for (const item of items) {
    const text = toText(item)
    const score = scoreMatch(q, text)
    if (score === null) continue
    matches.push({ item, score, exact: text.toLowerCase() === q })
  }

  matches.sort((a, b) => b.score - a.score || toText(a.item).localeCompare(toText(b.item)))
  return matches
}
