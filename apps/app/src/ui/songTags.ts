import { useMemo } from 'react'
import type { Tag } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'

const NO_TAGS: readonly never[] = []

/**
 * Each song's tags, looked up once per song and then kept.
 *
 * A row is memoised, and a fresh array of the same tags is a changed prop:
 * building the list in the render redrew every row each time. Kept by the
 * song object, so a song that did not change — every one but the song just
 * loved, after a love — keeps its array, and a library refetch that hands the
 * same songs back (React Query keeps unchanged objects) keeps them all.
 */
export function songTagLookup<T extends { readonly id: number }>(
  allTags: readonly T[],
): (song: { readonly tagIds: readonly number[] }) => readonly T[] {
  const byId = new Map(allTags.map(tag => [tag.id, tag]))
  const made = new WeakMap<object, readonly T[]>()
  return song => {
    if (song.tagIds.length === 0) return NO_TAGS
    let found = made.get(song)
    if (!found) {
      found = song.tagIds.flatMap(id => {
        const tag = byId.get(id)
        return tag ? [tag] : []
      })
      made.set(song, found)
    }
    return found
  }
}

const NO_LIBRARY_TAGS: readonly Tag[] = []

/**
 * `songTagLookup` over the library's tags, for a list that shows each row's
 * tags (`S3`): Library, Search and Up next. Made again only when the tags do.
 */
export function useSongTagLookup(): (song: {
  readonly tagIds: readonly number[]
}) => readonly Tag[] {
  const { data } = useLibrary()
  const tags = data?.tags ?? NO_LIBRARY_TAGS
  return useMemo(() => songTagLookup(tags), [tags])
}
