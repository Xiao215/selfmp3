import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, type Artist, type Tag } from '@selfmp3/shared'
import { radius, iconSize, coverSize } from '@selfmp3/client'
import { User } from './Icons'
import { SongLine } from './SongLine'
import { TagDot } from './TagDot'

/** A tag or an artist, as a search finds one. */
type Place =
  { readonly kind: 'tag'; readonly tag: Tag } | { readonly kind: 'artist'; readonly artist: Artist }

/**
 * A tag or an artist found by a search: a round figure where a song line has
 * its cover — the tag's dot, or a person — the name, and "Artist · 78 songs"
 * under it. Search's results and the command palette draw the same line, so a
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
  // Under the name, beside it rather than at the far end of the row (M1).
  const hint = `${place.kind === 'tag' ? 'Tag' : 'Artist'} · ${plural(count, 'song', 'songs')}`
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
      sub={hint}
      onPress={onPress}
      accessibilityLabel={`${name}, ${place.kind}, ${plural(count, 'song', 'songs')}`}
      style={style}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  // A round the size of a song line's cover.
  figure: {
    width: coverSize.line,
    height: coverSize.line,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}))
