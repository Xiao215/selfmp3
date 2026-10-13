import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { SectionHead } from '../../ui/components/SectionHead'
import { Shelf, SongCard } from '../../ui/components/Shelf'
import { playSimilarOrder } from './song.model'

/**
 * "Sounds like" on a song's own page (`P15`): the song's nearest neighbours by
 * tempo, key and energy, with its tempo and energy in words beside the
 * heading. A card plays that song with the rest after it.
 */
export function SimilarShelf({
  songs,
  heading,
  aside,
}: {
  songs: readonly Song[]
  heading: string
  /** Quiet words beside the heading. */
  aside: string
}): ReactNode {
  const player = usePlayerCommands()
  const ids = songs.map(song => song.id)

  return (
    <View style={styles.shelf} accessibilityLabel={heading} testID="similar-shelf">
      <SectionHead title={heading} aside={aside || undefined} />
      <Shelf gap={8}>
        {songs.map(song => (
          <SongCard
            key={song.id}
            song={song}
            size={SHELF_COVER}
            onPress={() =>
              player.playFrom(playSimilarOrder(ids, song.id), 0, {
                source: { kind: 'songs', origin: 'similar', name: `Similar to ${song.title}` },
              })
            }
          />
        ))}
      </Shelf>
    </View>
  )
}

/** The cards' cover, sized so three and a slice of a fourth fit a phone: the slice says it scrolls. */
const SHELF_COVER = 64

const styles = StyleSheet.create({
  shelf: { gap: space.sm, paddingBottom: space.sm },
})
