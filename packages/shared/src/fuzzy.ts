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
 * A candidate's text with the per-candidate work done once: the lowercase copy
 * every test reads, and the initials the acronym test reads.
 *
 * Kept apart from the query because a library search scores the same few
 * thousand songs on every keystroke. Lowercasing each one, and splitting it
 * into words for its initials, was most of what a keystroke cost — work whose
 * answer never changes while the library does not.
 */
export class FuzzyText {
  readonly text: string
  readonly lower: string
  #initials: string | undefined

  constructor(text: string) {
    this.text = text
    this.lower = text.toLowerCase()
  }

  /** Worked out the first time a query gets this far, which most never do. */
  get initials(): string {
    this.#initials ??= acronym(this.lower)
    return this.#initials
  }
}

/** A query with its own once-per-keystroke work done: the trim, and the word-start pattern. */
interface CompiledQuery {
  readonly q: string
  readonly wordPrefix: RegExp
  readonly tolerance: number
}

function compileQuery(query: string): CompiledQuery {
  const q = query.trim().toLowerCase()
  return {
    q,
    // No `g` flag: a global pattern remembers where it stopped, and would
    // answer the next candidate from the middle of it.
    wordPrefix: new RegExp(`\\b${escapeRegExp(q)}`),
    tolerance: q.length >= 6 ? 2 : q.length >= 4 ? 1 : 0,
  }
}

function scoreCompiled(query: CompiledQuery, candidate: FuzzyText): number | null {
  const { q, tolerance } = query
  const c = candidate.lower
  if (q.length === 0) return 0
  if (c === q) return SCORE_EXACT
  if (c.startsWith(q)) return SCORE_PREFIX - c.length
  if (query.wordPrefix.test(c)) return SCORE_WORD_PREFIX - c.length
  if (c.includes(q)) return SCORE_SUBSTRING - c.length
  if (candidate.initials.startsWith(q)) return SCORE_ACRONYM - c.length
  if (isSubsequence(q, c)) return SCORE_SUBSEQUENCE - c.length

  // Last resort: tolerate typos, but only proportionally to query length.
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
 * A match, with the text it was ranked by and where it stood in the input,
 * so ordering reads fields rather than rebuilding each item's text on every
 * comparison — a sort makes n log n of them.
 */
interface Scored<T> {
  readonly match: FuzzyMatch<T>
  readonly text: string
  readonly index: number
}

/**
 * Best first; equal scores alphabetically; and, as a stable sort leaves them,
 * in input order after that — spelled out so a partial selection agrees with
 * the full sort exactly.
 */
function bestFirst<T>(a: Scored<T>, b: Scored<T>): number {
  return b.match.score - a.match.score || a.text.localeCompare(b.text) || a.index - b.index
}

function scoreAll<T>(
  query: string,
  items: readonly T[],
  prepared: (item: T) => FuzzyText,
  keep: (scored: Scored<T>) => void,
): void {
  const compiled = compileQuery(query)
  for (let index = 0; index < items.length; index++) {
    const item = items[index] as T
    const candidate = prepared(item)
    const score = scoreCompiled(compiled, candidate)
    if (score === null) continue
    keep({
      match: { item, score, exact: candidate.lower === compiled.q },
      text: candidate.text,
      index,
    })
  }
}

/**
 * `fuzzyRank`, for candidates whose text is already prepared — the library,
 * which keeps each song's `FuzzyText` for as long as the song object lives.
 */
export function fuzzyRankPrepared<T>(
  query: string,
  items: readonly T[],
  prepared: (item: T) => FuzzyText,
): FuzzyMatch<T>[] {
  if (query.trim().length === 0) {
    return items.map(item => ({ item, score: 0, exact: false }))
  }
  const scored: Scored<T>[] = []
  scoreAll(query, items, prepared, one => scored.push(one))
  scored.sort(bestFirst)
  return scored.map(one => one.match)
}

/**
 * The first `count` of `fuzzyRankPrepared`, in the same order, without sorting
 * every match to throw most away: the palette shows eight songs out of a
 * library that can match thousands on a single letter.
 */
export function fuzzyTopPrepared<T>(
  query: string,
  items: readonly T[],
  prepared: (item: T) => FuzzyText,
  count: number,
): FuzzyMatch<T>[] {
  if (count <= 0) return []
  if (query.trim().length === 0) {
    return items.slice(0, count).map(item => ({ item, score: 0, exact: false }))
  }
  // Kept best-first. A newcomer comes later in the input than everything
  // kept, so it goes after anything it ties with, as the stable sort puts it.
  const kept: Scored<T>[] = []
  scoreAll(query, items, prepared, one => {
    const last = kept[kept.length - 1]
    if (kept.length >= count && last && bestFirst(one, last) >= 0) return
    let at = kept.length
    while (at > 0 && bestFirst(one, kept[at - 1] as Scored<T>) < 0) at--
    kept.splice(at, 0, one)
    if (kept.length > count) kept.pop()
  })
  return kept.map(one => one.match)
}

/**
 * Prepared text for objects, remembered per object. Weakly, so a library that
 * is refetched lets its old songs, and their text, go.
 */
export function preparedTextFor<T extends object>(
  toText: (item: T) => string,
): (item: T) => FuzzyText {
  const cache = new WeakMap<T, FuzzyText>()
  return item => {
    let prepared = cache.get(item)
    if (!prepared) {
      prepared = new FuzzyText(toText(item))
      cache.set(item, prepared)
    }
    return prepared
  }
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
  return fuzzyRankPrepared(query, items, item => new FuzzyText(toText(item)))
}
