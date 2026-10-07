import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { artistOr } from '@selfmp3/shared'
import { radius, space, type, withAlpha } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { usePlayer } from '../../player/PlayerProvider'
import { Cover } from '../../ui/components/Cover'
import { label } from '../../ui/surfaces'
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
  /** Quiet words on the right of the heading. */
  aside: string
}): ReactNode {
  const player = usePlayer()
  const artFor = useArt(ROW_COVER_SIZE)
  const ids = songs.map(song => song.id)

  return (
    <View style={styles.shelf} accessibilityLabel={heading} testID="similar-shelf">
      <View style={styles.head}>
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
        <Text style={styles.aside}>{aside}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {songs.map(song => (
          <Pressable
            key={song.id}
            onPress={() =>
              player.playFrom(playSimilarOrder(ids, song.id), 0, {
                source: { kind: 'songs', origin: 'similar', name: `Similar to ${song.title}` },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Play ${song.title} by ${artistOr(song.artist)}`}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <Cover uri={artFor(song)} title={song.album || song.title} size={SHELF_COVER} />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.cardArtist} numberOfLines={1}>
              {artistOr(song.artist)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

/** The cards' cover, sized so three and a slice of a fourth fit a phone: the slice says it scrolls. */
const SHELF_COVER = 64
/** The shelf's whole height: the heading, the cards and the gap under them. */
const SHELF_HEIGHT = 144

const styles = StyleSheet.create(theme => ({
  shelf: { height: SHELF_HEIGHT, paddingBottom: space.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  heading: label(theme.colors),
  aside: { color: theme.colors.textMuted, fontSize: type.small },
  list: { gap: 8, paddingRight: space.lg },
  card: { width: 84, padding: 4, gap: 3, borderRadius: radius.cover },
  cardPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.08) },
  cardTitle: { color: theme.colors.textPrimary, fontSize: 11, fontWeight: '600', marginTop: 3 },
  cardArtist: { color: theme.colors.textSecondary, fontSize: type.small - 2 },
}))
