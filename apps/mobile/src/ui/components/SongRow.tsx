import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { formatDuration, type Song } from '@selfmp3/shared'
import { useAccent } from '../accent'
import { oklchToHexAlpha , colors, HIT_TARGET, motion, radius, space, type } from '@selfmp3/client'
import { Cover } from './Cover'
import { Downloaded, Heart, More } from './Icons'
import { Equalizer } from './Equalizer'

/**
 * One song in a list: the web's `.song-row`, as it is on a phone.
 *
 * With a finger there is no hover to reveal anything, so a tap plays, the ⋯
 * is always there at a finger-sized target, and holding the row opens the
 * same menu. The heart is the other control that stays: loving a song is the
 * one edit worth making from a list. Title, artist and length are the only
 * ink; everything else is quiet metadata or a control.
 *
 * Memoised because the library list is long and re-renders on every progress
 * tick otherwise — the one place in this app where that actually matters.
 */
export const SongRow = memo(function SongRow({
  song,
  artUri,
  active,
  downloaded,
  playing = false,
  onPress,
  onMore,
  onToggleLoved,
}: {
  song: Song
  artUri: string | null
  active: boolean
  downloaded: boolean
  /** Whether the song is the one actually sounding, for the equaliser. */
  playing?: boolean
  onPress: () => void
  /** The ⋯, and what a held finger opens. */
  onMore?: () => void
  onToggleLoved?: () => void
}): ReactNode {
  const accent = useAccent()
  // The held-finger state, as on the web: the row gives a little under the
  // finger so something is visibly happening while the menu is on its way.
  const [scale] = useState(() => new Animated.Value(1))
  const press = (down: boolean): void => {
    Animated.timing(scale, {
      toValue: down ? 0.985 : 1,
      duration: motion.base,
      useNativeDriver: true,
    }).start()
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onLongPress={onMore}
        onPressIn={() => press(true)}
        onPressOut={() => press(false)}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.row,
          active && { backgroundColor: oklchToHexAlpha(0.72, 0.16, accent.hue, 0.13) },
          pressed && styles.pressed,
          song.missing && styles.missing,
        ]}
      >
        <View style={styles.art}>
          <Cover uri={artUri} title={song.album || song.title} size={40} />
          {active ? (
            <View style={styles.playingOverlay}>
              <Equalizer paused={!playing} size={12} />
            </View>
          ) : null}
        </View>

        <View style={styles.text}>
          <Text style={[styles.title, active && { color: accent.accent }]} numberOfLines={1}>
            {song.title}
          </Text>
          <View style={styles.subtitleRow}>
            {/* The web calls this "On this device", and draws exactly this. */}
            {downloaded ? (
              <Downloaded size={13} color={accent.accent} knockout={colors.surface0} />
            ) : null}
            <Text style={styles.subtitle} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
              {song.album ? ` · ${song.album}` : ''}
            </Text>
          </View>
        </View>

        {onToggleLoved ? (
          <Pressable
            onPress={onToggleLoved}
            accessibilityRole="button"
            accessibilityLabel={
              song.loved ? `Remove ${song.title} from loved` : `Love ${song.title}`
            }
            accessibilityState={{ selected: song.loved }}
            style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
          >
            <Heart
              size={16}
              filled={song.loved}
              color={song.loved ? colors.danger : colors.textMuted}
            />
          </Pressable>
        ) : null}

        <Text style={styles.duration}>{formatDuration(song.duration)}</Text>

        {onMore ? (
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${song.title}`}
            style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
          >
            <More size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    marginHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  pressed: {
    backgroundColor: colors.surface1,
  },
  missing: {
    opacity: 0.55,
  },
  art: {
    position: 'relative',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: type.small,
    flexShrink: 1,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 8, 16, 0.55)',
    borderRadius: radius.sm,
  },
  control: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  controlPressed: {
    backgroundColor: colors.surface2,
  },
  duration: {
    color: colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'right',
  },
})
