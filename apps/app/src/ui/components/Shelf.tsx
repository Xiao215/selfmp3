import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, type Song } from '@selfmp3/shared'
import { space, type } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { useDragScroll } from '../../ports/dragScroll'
import { rightClick, type PopoverAnchor } from '../rightClick'
import { tip } from '../tip'
import { Cover } from './Cover'
import { Press } from './Press'
import { ScrollView } from './Scroll'
import { useSongMenu } from './useSongMenu'

/** The song menu a shelf opens for its cards: one for the shelf, as a list has one. */
const ShelfMenu = createContext<ReturnType<typeof useSongMenu>['onMore'] | null>(null)

/**
 * A row that scrolls sideways, which a mouse drags along as a finger flicks
 * it (`useDragScroll`): a shelf's cards, a strip of chips.
 */
export function SideScroll({
  children,
  style,
  contentStyle,
  testID,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const drag = useDragScroll()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={contentStyle}
      testID={testID}
      {...drag}
    >
      {children}
    </ScrollView>
  )
}

/**
 * A row of cards that scrolls sideways: Home's recently played, Forgotten
 * gems, a song's "Sounds like". A song card's right-click opens the song's
 * menu, one menu for the shelf.
 */
export function Shelf({
  children,
  gap = 10,
  contentStyle,
  testID,
}: {
  children: ReactNode
  gap?: number
  contentStyle?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const menu = useSongMenu()
  return (
    <ShelfMenu.Provider value={menu.onMore}>
      <SideScroll contentStyle={[{ gap }, styles.content, contentStyle]} testID={testID}>
        {children}
        {/* Drawn over everything by the overlay host, wherever it stands here. */}
        {menu.menu}
      </SideScroll>
    </ShelfMenu.Provider>
  )
}

/**
 * One card on a shelf: a cover as wide as the card, its name, and a line or
 * two under it. It sinks under the finger, as everything pressed does, rather
 * than drawing a box behind it wider than the cover.
 */
export function ShelfCard({
  width,
  cover,
  title,
  lines,
  onPress,
  label,
  caption,
  onMenu,
  testID,
}: {
  width: number
  cover: ReactNode
  title: string
  /** Under the name: the artist, a kind, when it was last played. */
  lines: readonly string[]
  onPress: () => void
  label: string
  /** A hover caption, for a name cut short. */
  caption?: string
  /** Opened by a right-click, at the pointer. */
  onMenu?: (at: PopoverAnchor) => void
  testID?: string
}): ReactNode {
  const large = width >= LARGE_CARD
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tip(caption)}
      testID={testID}
      style={{ width }}
      {...rightClick(onMenu)}
    >
      {cover}
      <Text style={[styles.title, large && styles.titleLarge]} numberOfLines={1}>
        {title}
      </Text>
      {lines.map((line, index) => (
        <Text
          key={index}
          style={[index === 0 ? styles.line : styles.lineQuiet, large && styles.lineLarge]}
          numberOfLines={1}
        >
          {line}
        </Text>
      ))}
    </Press>
  )
}

/**
 * A song on a shelf: its cover, its title and its artist (and `more`, a line
 * of the shelf's own). Says "Play <title> by <artist>" to a screen reader and
 * the same on hover, where the card cuts a long name short; a right-click
 * opens the song's menu.
 */
export function SongCard({
  song,
  size,
  onPress,
  more,
  testID,
}: {
  song: Song
  size: number
  onPress: () => void
  /** A third line: when it was last played. */
  more?: string
  testID?: string
}): ReactNode {
  // A small card's picture is a row's; a large one's, the kept size.
  const art = useArt(size < LARGE_CARD ? ROW_COVER_SIZE : undefined)
  const onMore = useContext(ShelfMenu)
  const artist = artistOr(song.artist)
  return (
    <ShelfCard
      width={size}
      cover={<Cover uri={art(song)} title={song.album || song.title} size={size} />}
      title={song.title}
      lines={more ? [artist, more] : [artist]}
      onPress={onPress}
      label={`Play ${song.title} by ${artist}`}
      caption={`${song.title} — ${artist}`}
      onMenu={onMore ? at => onMore(at, song) : undefined}
      testID={testID}
    />
  )
}

/** A card this wide or wider sets its words a size up: Home's recents, not a song page's shelf. */
const LARGE_CARD = 90

const styles = StyleSheet.create(theme => ({
  content: { paddingRight: space.lg },
  title: {
    color: theme.colors.textPrimary,
    fontSize: type.tiny,
    fontWeight: '600',
    marginTop: 6,
  },
  titleLarge: { fontSize: type.small },
  line: { color: theme.colors.textSecondary, fontSize: type.tiny },
  lineQuiet: { color: theme.colors.textMuted, fontSize: type.tiny },
  lineLarge: { fontSize: type.small },
}))
