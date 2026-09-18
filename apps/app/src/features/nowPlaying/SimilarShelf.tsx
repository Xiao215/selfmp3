import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { radius, space, type, withAlpha } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { Cover } from '../../ui/components/Cover'
import { label } from '../../ui/surfaces'
import { playSimilarOrder, SIMILAR_SHELF_HEIGHT } from './nowPlaying.model'

/**
 * Similar songs under the controls, on a phone.
 *
 * Nearest neighbours of the song playing, by tempo, key and energy. A card plays
 * that song with the rest after it; "Queue all" adds them behind what is queued.
 * The page decides whether there is room (`similarShelfLayout`); this only
 * draws what it is given.
 */
export function SimilarShelf({ songs }: { songs: readonly Song[] }): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const ids = songs.map(song => song.id)

  return (
    <View style={styles.shelf} accessibilityLabel="Similar songs" testID="similar-shelf">
      <View style={styles.head}>
        <Text style={styles.heading} accessibilityRole="header">
          Similar songs
        </Text>
        {/* A small pill the height of the heading, not a full-size button: it sat on the page as a dark block. */}
        <Pressable
          onPress={() => player.addToQueue(ids)}
          accessibilityRole="button"
          accessibilityLabel="Queue all"
          hitSlop={10}
          style={({ pressed }) => [styles.queueAll, pressed && styles.queueAllPressed]}
        >
          <Text style={styles.queueAllText}>Queue all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {songs.map(song => (
          <Pressable
            key={song.id}
            onPress={() => player.playFrom(playSimilarOrder(ids, song.id), 0)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${song.title} by ${song.artist || 'Unknown artist'}`}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <Cover uri={artFor(song)} title={song.album || song.title} size={SHELF_COVER} />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.cardArtist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

/** The cards' cover, sized so three and a slice of a fourth fit a phone: the slice says it scrolls. */
const SHELF_COVER = 64

const styles = StyleSheet.create(theme => ({
  /*
   * The height the page took off the cover for this, rather than whatever the
   * cards add up to: the two agreeing is what keeps the page still while the
   * songs are on their way (`SIMILAR_SHELF_HEIGHT`).
   */
  shelf: { height: SIMILAR_SHELF_HEIGHT, paddingBottom: space.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  heading: label(theme.colors),
  queueAll: {
    paddingVertical: 4,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.1),
  },
  queueAllPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.2) },
  queueAllText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' },
  list: { gap: 8, paddingRight: space.lg },
  card: { width: 84, padding: 4, gap: 3, borderRadius: radius.cover },
  cardPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.08) },
  cardTitle: { color: theme.colors.textPrimary, fontSize: 11, fontWeight: '600', marginTop: 3 },
  cardArtist: { color: theme.colors.textSecondary, fontSize: type.small - 2 },
}))
