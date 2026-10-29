import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { SectionHead } from '../../ui/components/SectionHead'
import { Shelf, SongCard } from '../../ui/components/Shelf'
import { playSimilarOrder } from './song.model'

/**
 * "Sounds like" on a song's own page (`P15`): the song's nearest neighbours by
 * tempo, key and energy. A card plays that song with the rest after it.
 *
 * The heading alone: the song's tempo and energy are the Sound strip's, just
 * above (F1, 2026-10-25). The cards are Home's Recently played's size, with
 * two lines for a name, so "雪国 - Snow Country" is not cut to "雪国 - Sno…".
 */
export function SimilarShelf({
  songs,
  heading,
}: {
  songs: readonly Song[]
  heading: string
}): ReactNode {
  const player = usePlayerCommands()
  const { wide } = useLayout()
  const ids = songs.map(song => song.id)

  return (
    <View style={styles.shelf} accessibilityLabel={heading} testID="similar-shelf">
      <SectionHead title={heading} />
      <Shelf gap={10}>
        {songs.map(song => (
          <SongCard
            key={song.id}
            song={song}
            size={wide ? SHELF_COVER_WIDE : SHELF_COVER}
            titleLines={2}
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

/** Home's Recently played cards: three and a slice of a fourth on a phone, the slice saying it scrolls. */
const SHELF_COVER = 92
const SHELF_COVER_WIDE = 132

const styles = StyleSheet.create({
  shelf: { gap: space.sm, paddingBottom: space.sm },
})
