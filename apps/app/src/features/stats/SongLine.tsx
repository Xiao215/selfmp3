import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { Cover } from '../../ui/components/Cover'

/**
 * A song in a ranked or recent list. Tapping plays it; a song no longer in
 * the library is shown but cannot be played.
 */
export function SongLine({
  song,
  title,
  artist,
  rank,
  trailing,
}: {
  song: Song | undefined
  title: string
  artist: string
  rank?: number
  trailing: string
}): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      disabled={!song}
      onPress={() => song && player.playFrom([song.id], 0)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${artist || 'Unknown artist'}, ${trailing}`}
      style={({ pressed }) => [styles.line, (hovered || pressed) && song && styles.lineHovered]}
    >
      {rank !== undefined ? <Text style={styles.rank}>{rank}</Text> : null}
      <Cover uri={song ? artFor(song) : null} title={title} size={34} />
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {artist || 'Unknown artist'}
        </Text>
      </View>
      <Text style={styles.trailing}>{trailing}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: radius.cover,
  },
  lineHovered: { backgroundColor: theme.colors.surface2 },
  rank: { width: 20, color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  meta: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  artist: { color: theme.colors.textMuted, fontSize: 12 },
  trailing: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
}))
