import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { splitArtists, UNKNOWN_ARTIST } from '@selfmp3/shared'
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
 *
 * `onOpen` is how the page goes there, where a plain navigation is not right:
 * the phone's Now Playing is a modal, and has to go down first (`leaveTo`).
 */
export function ArtistLinks({
  artist,
  onOpen,
}: {
  artist: string
  onOpen?: (href: Href) => void
}): ReactNode {
  const router = useRouter()
  const names = splitArtists(artist)
  if (names.length === 0) return UNKNOWN_ARTIST
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 ? ', ' : null}
          <Text
            onPress={() => {
              const href = artistLink(name)
              if (onOpen) onOpen(href)
              else router.navigate(href)
            }}
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
