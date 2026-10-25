import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { MissingPage } from '../../ui/components/MissingPage'

/**
 * A tag or an artist the address names and the library does not hold: a tag
 * renamed or deleted since the link was made, an artist whose songs are gone.
 */
export function PlaceMissing({
  kind,
  name,
}: {
  kind: 'tag' | 'artist' | 'combined'
  name: string
}): ReactNode {
  const router = useRouter()
  return (
    <MissingPage
      testID="place-missing"
      title={kind === 'tag' ? 'No such tag' : kind === 'artist' ? 'No such artist' : 'Nothing here'}
      line={
        kind === 'tag'
          ? `Nothing here is tagged “${name}”. It may have been renamed or deleted.`
          : kind === 'artist'
            ? `No song here is by “${name}”.`
            : 'The tags and artists this was made of have been renamed or deleted.'
      }
      back="/"
      action={{
        label: kind === 'artist' ? 'Home' : 'All tags',
        onPress: () => router.replace(kind === 'artist' ? '/' : '/tags'),
      }}
    />
  )
}

/**
 * A tag's or an artist's page before the library is there to find it in:
 * the way back, and a word on why there is nothing yet. It had drawn nothing
 * at all, and a library that did not load left a blank page with no way out.
 */
export function PlaceWaiting(): ReactNode {
  const router = useRouter()
  const { isError } = useLibrary()
  return (
    <MissingPage
      testID="place-waiting"
      title={isError ? 'Your library didn’t load' : 'Loading…'}
      line={isError ? 'This page shows once it can be reached.' : undefined}
      back="/"
      action={isError ? { label: 'Home', onPress: () => router.replace('/') } : undefined}
    />
  )
}
