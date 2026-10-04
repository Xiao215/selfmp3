import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import {
  combinedLink,
  combinedPlaces,
  parseCombinedParams,
  placesSource,
} from '../lists/lists.model'
import { artistLink, tagLink } from './placeLinks'
import { PlaceMissing } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import type { Place } from './tag.model'

/**
 * Tags and artists put together, `/combined?tags=…&artists=…`
 * (docs/features/lists.md, B1).
 *
 * It opens over the tag or artist page it was combined from, so Back goes
 * there, and the Library tab's own filter is never touched. Its chips are the
 * address: taking one off or adding one rewrites it in place. Down to one, it
 * becomes that tag's or artist's own page.
 */
export function CombinedScreen(): ReactNode {
  const router = useRouter()
  const params = useLocalSearchParams<{ tags?: string; artists?: string }>()
  const { data: library } = useLibrary()
  const wanted = useMemo(() => parseCombinedParams(params), [params])
  const places = useMemo(
    () => (library ? combinedPlaces(wanted, library.tags, library.songs) : []),
    [wanted, library],
  )

  if (!library) return null
  if (places.length === 0) return <PlaceMissing kind="combined" name="" />

  const change = (next: readonly Place[]): void => {
    const [only] = next
    if (!only) return
    if (next.length === 1) {
      router.replace(only.kind === 'tag' ? tagLink(only.tag.name) : artistLink(only.artist.name))
      return
    }
    const source = placesSource(next)
    if (source?.kind !== 'combined') return
    const link = combinedLink(source)
    router.setParams({ tags: link.params?.['tags'], artists: link.params?.['artists'] })
  }

  return <PlacePage places={places} onChange={change} />
}
