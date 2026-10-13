import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, type Artist, type Tag } from '@selfmp3/shared'
import { radius, type, iconSize } from '@selfmp3/client'
import { User } from './Icons'
import { SONG_LINE_COVER, SongLine } from './SongLine'
import { TagDot } from './TagDot'

/** A tag or an artist, as a search finds one. */
type Place =
  { readonly kind: 'tag'; readonly tag: Tag } | { readonly kind: 'artist'; readonly artist: Artist }

/**
 * A tag or an artist found by a search: a round figure where a song line has
 * its cover — the tag's dot, or a person — the name, and "12 songs · tag" at
 * the end. Search's results and the command palette draw the same line, so a
 * place reads the same in both and beside the song lines under it.
 *
 * Given `onPress` it is pressable; without, it is the face alone, for the
 * palette, whose rows own their press and their highlight.
 */
export function PlaceLine({
  place,
  onPress,
  style,
}: {
  place: Place
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const name = place.kind === 'tag' ? place.tag.name : place.artist.name
  const count = place.kind === 'tag' ? place.tag.songCount : place.artist.songIds.length
  const hint = `${plural(count, 'song', 'songs')} · ${place.kind}`
  return (
    <SongLine
      cover={
        <View style={styles.figure}>
          {place.kind === 'tag' ? (
            <TagDot hue={place.tag.hue} size={10} />
          ) : (
            <User size={iconSize.button} tone="textSecondary" />
          )}
        </View>
      }
      title={name}
      trailing={<Text style={styles.hint}>{hint}</Text>}
      onPress={onPress}
      accessibilityLabel={`${name}, ${place.kind}, ${plural(count, 'song', 'songs')}`}
      style={style}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  // A round the size of a song line's cover.
  figure: {
    width: SONG_LINE_COVER,
    height: SONG_LINE_COVER,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: theme.colors.textMuted, fontSize: type.tiny },
}))
