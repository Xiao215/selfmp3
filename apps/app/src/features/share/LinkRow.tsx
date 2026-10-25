import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, type ShareSummary } from '@selfmp3/shared'
import { HIT_TARGET, coverSize, iconSize, radius, space, type } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { EASE_OUT_CSS, MOVE_MS } from '../../ui/motion.model'
import { rightClick } from '../../ui/rightClick'
import { rowTitle } from '../../ui/surfaces'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { More } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { Reveal } from '../../ui/components/Reveal'
import { sentLine, sentSub, sentTime, shareStage } from './share.model'

/**
 * A link in Links you shared, drawn as Library draws a song (A1), so the page
 * reads as a list you already know: there is no play, and a press opens the
 * link's page.
 *
 * At desktop width: the circle that picks it, the cover, the name over who
 * opened it, how many songs in a column of their own where Library has the
 * album, and how long it has at the end where a song's length is — amber on its
 * last day, quiet once it is over — then ⋯. With a mouse the circle and the ⋯
 * wait for the pointer. On a phone it is the cover, the name over the whole
 * line, and ⋯; holding it picks it.
 *
 * An ended link keeps its row at full strength and only its cover faded: it
 * is still something to act on (share again, remove).
 */
export const LinkRow = memo(function LinkRow({
  link,
  cover,
  now,
  selected,
  picking,
  onPress,
  onLongPress,
  onToggle,
  onMore,
}: {
  link: ShareSummary
  /** Its cover's address, none, or undefined for one on its way (`useOwnCover`). */
  cover: string | null | undefined
  now: number
  selected: boolean
  /** Choosing is on, so every row shows its circle. */
  picking: boolean
  onPress: (event: GestureResponderEvent, link: ShareSummary) => void
  onLongPress: (link: ShareSummary) => void
  onToggle: (link: ShareSummary) => void
  onMore: (link: ShareSummary) => void
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const dense = useLayoutValue(layout => layout.dense)
  const [hovered, setHovered] = useState(false)
  const stage = shareStage(link, now)
  const over = stage === 'ended'
  const testID = `links-row-${link.id}`

  // The press target: the cover and the words, which give a little under the
  // finger as a song row's do. The circle and the ⋯ press as themselves.
  const target = (
    wrap: StyleProp<ViewStyle>,
    style: StyleProp<ViewStyle>,
    children: ReactNode,
  ): ReactNode => (
    <Press
      depth="row"
      wrap={wrap}
      style={style}
      onPress={event => onPress(event, link)}
      onLongPress={() => onLongPress(link)}
      delayLongPress={MOVE_MS.longPress}
      accessibilityRole="link"
      accessibilityLabel={`Open ${link.name}`}
      testID={testID}
    >
      {children}
    </Press>
  )
  const art = (size: number): ReactNode => (
    <View style={over ? styles.faded : undefined}>
      <Cover uri={cover} title={link.name} size={size} />
    </View>
  )
  const name = (
    <Text style={styles.title} numberOfLines={1}>
      {link.name}
      {/* A friend asked for it again: the card at the page's head says who. */}
      {link.asks.length > 0 ? <Text style={styles.askDot}> ●</Text> : null}
    </Text>
  )
  const box = (
    <Checkbox
      checked={selected}
      onChange={() => onToggle(link)}
      label={selected ? `Deselect ${link.name}` : `Select ${link.name}`}
      style={wide ? styles.selectWide : styles.select}
    />
  )
  const more = (
    <IconButton label={`More for ${link.name}`} caption="More" onPress={() => onMore(link)}>
      <More size={iconSize.item} tone="textMuted" />
    </IconButton>
  )
  const onRightClick = rightClick(() => onMore(link))

  if (!wide) {
    return (
      <View role="row" style={[styles.row, selected && styles.selected]} {...onRightClick}>
        {picking || selected ? box : null}
        {target(
          styles.grow,
          styles.body,
          <>
            {art(coverSize.row)}
            <View style={styles.text}>
              {name}
              <Text style={styles.sub} numberOfLines={1}>
                {sentLine(link, now)}
              </Text>
            </View>
          </>,
        )}
        {more}
      </View>
    )
  }

  // With a mouse these wait for the pointer; a tablet at this width shows them.
  const revealed = !dense || hovered
  return (
    <View
      role="row"
      style={[styles.rowWide, dense && revealed && styles.rowHovered, selected && styles.selected]}
      onPointerEnter={dense ? () => setHovered(true) : undefined}
      onPointerLeave={dense ? () => setHovered(false) : undefined}
      {...onRightClick}
    >
      {picking || selected || dense ? (
        <Reveal shown={picking || selected || revealed}>{box}</Reveal>
      ) : null}
      {target(
        styles.mainWide,
        styles.main,
        <>
          {art(coverSize.rowDense)}
          <View style={styles.text}>
            {name}
            <Text style={styles.subWide} numberOfLines={1}>
              {sentSub(link, now)}
            </Text>
          </View>
        </>,
      )}
      <Text style={styles.songs} numberOfLines={1}>
        {plural(link.songs, 'song', 'songs')}
      </Text>
      <Text
        style={[styles.time, stage === 'lastDay' && styles.timeLastDay, over && styles.timeOver]}
        numberOfLines={1}
      >
        {sentTime(link, now)}
      </Text>
      <Reveal shown={revealed}>{more}</Reveal>
    </View>
  )
})

const styles = StyleSheet.create(theme => ({
  // `SongRow`'s phone row.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingVertical: 5,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    marginHorizontal: space.xs,
    borderRadius: radius.row,
    overflow: 'hidden',
  },
  // `SongRow`'s desktop row: 7 by 10, 12 between cells.
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 7,
    paddingHorizontal: space.snug,
    marginHorizontal: space.sm,
    borderRadius: radius.row,
    overflow: 'hidden',
    _web: {
      transitionProperty: 'background-color',
      transitionDuration: `${MOVE_MS.hoverOut}ms`,
      transitionTimingFunction: EASE_OUT_CSS,
    },
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
    _web: { transitionDuration: `${MOVE_MS.hoverIn}ms` },
  },
  selected: { backgroundColor: theme.colors.accentSelected },
  grow: { flex: 1, minWidth: 0 },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 3,
  },
  // Held to a reading width, as a song's title and album are (P1 C).
  mainWide: { flex: 1, minWidth: 0, maxWidth: 720 },
  main: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  faded: { opacity: 0.45 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: rowTitle(theme.colors),
  askDot: { color: theme.colors.accent, fontSize: type.tiny },
  sub: { color: theme.colors.textSecondary, fontSize: type.sub },
  subWide: { color: theme.colors.textSecondary, fontSize: type.small },
  // Where a song's album is: a fixed column, so it lines up down the page.
  songs: {
    width: 84,
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
  // Where a song's length is: at the row's far end, with the ⋯, however
  // wide the page — the words before it are held to a reading width.
  time: {
    width: 116,
    marginLeft: 'auto',
    textAlign: 'right',
    color: theme.colors.textSecondary,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
  timeLastDay: { color: theme.colors.warning },
  timeOver: { color: theme.colors.textMuted },
  select: {
    width: 34,
    height: HIT_TARGET,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectWide: {
    width: 24,
    height: 24,
    marginLeft: -4,
    alignItems: 'center',
    justifyContent: 'center',
  },
}))
