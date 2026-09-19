import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { useRouter } from 'expo-router'
import { splitArtists } from '@selfmp3/client'
import { artistLink } from '../tag/placeLinks'

/**
 * A song's artists, each one a door to its own page (docs/UI-MIGRATION.md,
 * Phase 4: artists are places).
 *
 * Words inside the caller's own line of text, not a row of buttons: they
 * wrap, truncate and take the line's style as the plain name did, so the page
 * looks as it did until a name is tapped. A collaboration is one link per
 * name, with a comma between them. A song with no artist says so, and that is
 * not a link to anything.
 */
export function ArtistLinks({ artist }: { artist: string }): ReactNode {
  const router = useRouter()
  const names = splitArtists(artist)
  if (names.length === 0) return 'Unknown artist'
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 ? ', ' : null}
          <Text
            onPress={() => router.navigate(artistLink(name))}
            accessibilityRole="link"
            accessibilityLabel={`Go to ${name}`}
            testID={`now-playing-artist-${i}`}
          >
            {name}
          </Text>
        </Fragment>
      ))}
    </>
  )
}
