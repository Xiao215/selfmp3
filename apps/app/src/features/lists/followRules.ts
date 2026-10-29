import type { SmartRules, SortDirection, SongSortField } from '@selfmp3/shared'

/**
 * The rule set behind a playlist that fills from tags: any of them, or all of
 * them when the combination it was kept from asked for all (C1), in the order
 * the library was showing. Up next's Save makes one from tags played
 * together, the Combined page's Keep as playlist from tags on show
 * (docs/features/lists.md).
 *
 * The match is the list's own — a saved playlist that quietly meant something
 * different from the list it was saved from would be the worst kind of
 * surprise. The sort comes along for the same reason.
 */
export function followRules(input: {
  tagIds: readonly number[]
  match?: 'any' | 'all'
  sort: SongSortField
  descending: boolean
}): SmartRules {
  return {
    match: input.match ?? 'any',
    rules: input.tagIds.map(tagId => ({ field: 'tag' as const, op: 'has' as const, tagId })),
    orderBy: input.sort,
    order: (input.descending ? 'desc' : 'asc') satisfies SortDirection,
    limit: null,
  }
}
