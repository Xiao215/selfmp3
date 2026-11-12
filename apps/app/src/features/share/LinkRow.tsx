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
import { Copy, More } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { Reveal } from '../../ui/components/Reveal'
import { sentRowSub, sentRowWhen, sentSub, sentTime, shareStage } from './share.model'
import { selectedBand } from '../../ui/components/selectedBand'

/**
 * A link in Links you shared, drawn as Library draws a song (Oct 23's A1), so the page
 * reads as a list you already know: there is no play, and a press opens the
 * link's page.
 *
 * On a phone (Nov 11's A1) it is drawn as a mail list draws a message: the
 * cover, the name with how long it has (or the day it ended) at the right
 * edge, and under it who opened it, or how many songs and plays an ended one
 * had; then copy and ⋯. Holding it picks it.
 *
 * At desktop width: the circle that picks it, the cover, the name over who
 * opened it, how many songs in a column of their own where Library has the
 * album, and how long it has at the end where a song's length is — amber on its
 * last day, quiet once it is over — then copy and ⋯. With a mouse the circle,
 * the copy and the ⋯ wait for the pointer. Copy is for a link that still
 * plays: an ended one keeps its place empty, so the columns line up.
 *
 * While choosing, copy and ⋯ step aside at both widths: the bar is where you
 * act. A ticked row is a faint band joined with the ticked rows beside it
 * (B3). An ended link is drawn at full strength, cover too: the section head
 * already says it is over.
 */
export const LinkRow = memo(function LinkRow({
  link,
  cover,
  now,
  selected,
  selectedAbove,
  selectedBelow,
  picking,
  onPress,
  onLongPress,
  onToggle,
  onMore,
  onCopy,
}: {
  link: ShareSummary
  /** Its cover's address, none, or undefined for one on its way (`useOwnCover`). */
  cover: string | null | undefined
  now: number
  selected: boolean
  /** The rows touching it are ticked too, so its band joins theirs. */
  selectedAbove: boolean
  selectedBelow: boolean
  /** Choosing is on, so every row shows its circle. */
  picking: boolean
  onPress: (event: GestureResponderEvent, link: ShareSummary) => void
  onLongPress: (link: ShareSummary) => void
  onToggle: (link: ShareSummary) => void
  onMore: (link: ShareSummary) => void
  /** Puts the link's address on the clipboard. */
  onCopy: (link: ShareSummary) => void
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
  const art = (size: number): ReactNode => <Cover uri={cover} title={link.name} size={size} />
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
  const copy = (
    <IconButton
      label={`Copy link to ${link.name}`}
      caption="Copy link"
      onPress={() => onCopy(link)}
    >
      <Copy size={iconSize.item} tone="textMuted" />
    </IconButton>
  )
  const onRightClick = rightClick(() => onMore(link))
  const band = selectedBand(selected, selectedAbove, selectedBelow)

  if (!wide) {
    return (
      <View
        role="row"
        style={[styles.row, (picking || selected) && styles.rowPicking, band]}
        {...onRightClick}
      >
        {picking || selected ? box : null}
        {target(
          styles.grow,
          styles.body,
          <>
            {art(coverSize.row)}
            <View style={styles.text}>
              <View style={styles.nameLine}>
                <View style={styles.grow}>{name}</View>
                <Text
                  style={[styles.when, stage === 'lastDay' && styles.timeLastDay]}
                  numberOfLines={1}
                >
                  {sentRowWhen(link, now)}
                </Text>
              </View>
              <Text style={styles.sub} numberOfLines={1}>
                {sentRowSub(link, now)}
              </Text>
            </View>
          </>,
        )}
        {picking || selected ? null : (
          <>
            {over ? null : copy}
            {more}
          </>
        )}
      </View>
    )
  }

  // With a mouse these wait for the pointer; a tablet at this width shows them.
  const revealed = !dense || hovered
  return (
    <View
      role="row"
      style={[styles.rowWide, dense && revealed && !selected && styles.rowHovered, band]}
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
      {/* Kept in place while choosing, so the columns hold still; only hidden. */}
      <Reveal shown={revealed && !picking}>
        {over ? <View style={dense ? styles.copySpaceDense : styles.copySpace} /> : copy}
      </Reveal>
      <Reveal shown={revealed && !picking}>{more}</Reveal>
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
  text: { flex: 1, minWidth: 0, gap: 1 },
  // While choosing the row ends in words, not buttons: as far in as it starts.
  rowPicking: { paddingRight: space.lg },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  when: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
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
  // An ended link's empty copy place, as wide as an IconButton.
  copySpace: { width: HIT_TARGET },
  copySpaceDense: { width: 34 },
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
