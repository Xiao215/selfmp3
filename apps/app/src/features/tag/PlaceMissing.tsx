import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
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
