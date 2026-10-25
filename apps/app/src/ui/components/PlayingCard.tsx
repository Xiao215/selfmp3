import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { radius, space, type, withAlpha, coverSize } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { label as labelText, rowTitle, textColumn } from '../surfaces'
import { useSongColor } from '../useSongColor'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'

/** Every playing card is this tall, whatever its label and line say. */
const PLAYING_CARD_HEIGHT = 68

/**
 * The song playing, at the top of Up next: its cover under the equaliser, its
 * colour washed behind it, a quiet label over its name ("Playing", "Played",
 * "Paused · Mia's"), a line under it that ticks on its own, and whatever the
 * place needs at its end — play and pause, a room's Skip.
 *
 * One card for the phone's sheet, the computer's rail and a room: the three
 * had been built apart, and drifted — a room's cover was lettered from the
 * title where the others used the album, its card was a minimum height where
 * the sheet's was a height, and its play button pressed flat.
 *
 * Given `onOpen`, the card (all but its end) opens Now Playing.
 *
 * The computer's rail draws it quieter (`foot`): no label, the title in the
 * song's colour instead, and where the song has got as a thin line along the
 * card's foot rather than a clock that pushed the artist out.
 */
export function PlayingCard({
  song,
  label,
  line,
  clock,
  playing,
  onOpen,
  badge,
  foot,
  children,
  testID,
}: {
  song: Song
  /** Over the title; without one the title takes the song's colour. */
  label?: string
  /** Under the title: who it is by. */
  line: ReactNode
  /**
   * After the line, kept whole: where the song has got, on the player's clock
   * or a room's. Said in the same line, its ellipsis took the one part of it
   * that moves ("Yorushika · 0:04 of …" in the rail).
   */
  clock?: ReactNode
  /** The equaliser moves while it plays and rests while it does not. */
  playing: boolean
  onOpen?: () => void
  /** Over the cover's corner: who brought a room's song. */
  badge?: ReactNode
  /** Along the card's foot, in the song's colour: how far it has played. */
  foot?: (tint: string) => ReactNode
  /** At the card's end: play and pause, Skip. */
  children?: ReactNode
  /** On the part that opens Now Playing, where a flow finds the song playing. */
  testID?: string
}): ReactNode {
  const art = useArt(ROW_COVER_SIZE)(song)
  const tone = useSongColor(song, art)
  const face = (
    <>
      <View>
        <Cover uri={art} title={song.album || song.title} size={coverSize.row} />
        <View style={styles.equalizer} pointerEvents="none">
          <Equalizer paused={!playing} size={14} color={tone.tint} />
        </View>
        {badge ? <View style={styles.badge}>{badge}</View> : null}
      </View>
      <View style={styles.text}>
        {label ? (
          <Text style={[styles.label, { color: tone.tint }]} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        <Text style={[styles.title, !label && { color: tone.tint }]} numberOfLines={1}>
          {song.title}
        </Text>
        <View style={styles.lineRow}>
          <Text style={[styles.line, styles.lineShrinks]} numberOfLines={1}>
            {line}
          </Text>
          {clock ? (
            <Text style={[styles.line, styles.clock]} numberOfLines={1}>
              {/* A no-break space: a text's leading space is dropped where it begins a box. */}
              {'\u00a0· '}
              {clock}
            </Text>
          ) : null}
        </View>
      </View>
    </>
  )
  return (
    <View style={[styles.card, { backgroundColor: withAlpha(tone.color, 0.2) }]}>
      {onOpen ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${label ?? 'Playing'} ${song.title}. Open now playing`}
          testID={testID}
          style={styles.main}
        >
          {face}
        </Pressable>
      ) : (
        <View style={styles.main} testID={testID}>
          {face}
        </View>
      )}
      {children}
      {foot ? (
        <View style={styles.foot} pointerEvents="none">
          {foot(tone.tint)}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: PLAYING_CARD_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.mini,
    overflow: 'hidden',
  },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  equalizer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.cover,
    // The shade a playing row lays over its cover (`SongRow`).
    backgroundColor: theme.colors.coverShade,
  },
  badge: { position: 'absolute', right: -5, bottom: -5 },
  text: textColumn,
  label: labelText(theme.colors),
  title: rowTitle(theme.colors),
  lineRow: { flexDirection: 'row' },
  lineShrinks: { flexShrink: 1 },
  clock: { flexShrink: 0 },
  line: {
    color: theme.colors.textSecondary,
    fontSize: type.sub,
    fontVariant: ['tabular-nums'],
  },
}))
