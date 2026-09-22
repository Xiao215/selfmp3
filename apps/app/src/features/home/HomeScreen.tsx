import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, ScrollView, Text, View } from 'react-native'
import type { ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { plural } from '@selfmp3/shared'
import type { Song, Stats } from '@selfmp3/shared'
import { fonts, radius, tagColors, type, useLibrary, type ServerConnection } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { useArt } from '../../offline/useArt'
import { useDragScroll } from '../../ports/dragScroll'
import { Avatar } from '../../ui/components/Avatar'
import { useAccount } from '../profile/useAccount'
import { usePlayer } from '../../player/PlayerProvider'
import { setPaletteOpen } from '../../shell/palette'
import { useBottomInset } from '../../shell/bottomInset'
import { useContentWidth } from '../../shell/contentWidth'
import { useLayout } from '../../shell/useLayout'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Download, Plus, Search } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { session, useArrival, usePressScale } from '../../ui/motion'
import { artShadow, card, sectionTitle, serif } from '../../ui/surfaces'
import { tagLink } from '../tag/placeLinks'
import { useStatsFor } from '../stats/statsSource'
import {
  greeting,
  HOME_TILES,
  HOME_TILES_WIDE,
  homeTiles,
  recentlyPlayed,
  streakLine,
  sundayCard,
  type HomeTile,
} from './home.model'

/**
 * Home: where the app opens (docs/ui-mock `P04`, `C03`).
 *
 * A greeting and one quiet line, one search field, the tags you play most as
 * tiles, and what you played last. On a phone the header carries the + that
 * opens Import and the avatar that opens You; a computer has those in its
 * sidebar, and adds this week's numbers beside the tiles. No date line: the
 * greeting under it already says what time of day it is (Xiao, 2026-09-20).
 *
 * Stats come from the server, as they do on the Stats page: a cloud library has
 * a streak to show only while its server is within reach, and shows none
 * otherwise rather than a zero.
 */
export function HomeScreen(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <CloudStats /> : <WithStats via={undefined} />
}

function CloudStats(): ReactNode {
  const reach = useServerDirect()
  return <WithStats via={reach.state === 'reachable' ? reach.connection : undefined} />
}

function WithStats({ via }: { via: ServerConnection | undefined }): ReactNode {
  const { data: stats } = useStatsFor(via, '7d')
  return <HomePage stats={stats} />
}

/** The clock, to the minute, for the greeting. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function HomePage({ stats }: { stats: Stats | undefined }): ReactNode {
  const { wide } = useLayout()
  const beside = useCardsBeside(wide)
  const router = useRouter()
  const now = useNow()
  const bottom = useBottomInset()
  const { data: library } = useLibrary()
  const tiles = useMemo(
    () =>
      library ? homeTiles(library.tags, library.songs, wide ? HOME_TILES_WIDE : HOME_TILES) : [],
    [library, wide],
  )
  const recents = useMemo(() => (library ? recentlyPlayed(library.songs) : []), [library])
  const line = streakLine(stats?.streakDays)
  const sunday = sundayCard(now, stats)

  // The one Search, starting on All: the page on a phone, the palette over
  // this page on a computer (docs/ui-mock `P18`, `C05`).
  const openSearch = (): void => {
    if (wide) setPaletteOpen(true)
    else router.navigate({ pathname: '/search', params: { scope: 'all' } })
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        testID="home-screen"
        contentContainerStyle={[
          styles.content,
          wide ? styles.contentWide : styles.contentNarrow,
          { paddingBottom: bottom + 24 },
        ]}
      >
        {wide ? null : <PhoneHeader />}

        <View style={styles.greetingBlock}>
          <Text style={styles.greeting} accessibilityRole="header">
            {greeting(now.getHours())}
            <Text style={styles.greetingDot}>.</Text>
          </Text>
          {line === null ? null : <Text style={styles.subline}>{line}</Text>}
        </View>

        {sunday ? (
          <Pressable
            testID="home-sunday"
            onPress={() =>
              router.navigate({ pathname: '/stats/report', params: { range: 'week' } })
            }
            accessibilityRole="link"
            accessibilityLabel={`${sunday.title}. ${sunday.line}`}
            style={({ pressed }) => [styles.sunday, pressed && styles.sundayPressed]}
          >
            <View style={styles.sundayText}>
              <Text style={styles.sundayTitle}>{sunday.title}</Text>
              <Text style={styles.sundayLine} numberOfLines={1}>
                {sunday.line}
              </Text>
            </View>
            <ChevronRight size={16} tone="textSecondary" />
          </Pressable>
        ) : null}

        <SearchField wide={wide} onPress={openSearch} />

        <View style={beside ? styles.columns : styles.stack}>
          <View style={beside ? styles.mainColumn : styles.stack}>
            {/* The count is the head's own action, as Recently played's Library
                is, rather than a link under the tiles (Xiao, 2026-09-20). */}
            <SectionHead
              testID="home-all-tags"
              title="Your tags"
              action={
                library && library.tags.length > 0
                  ? {
                      label: `All ${library.tags.length}`,
                      onPress: () => router.navigate('/tags'),
                    }
                  : null
              }
            />
            <Tiles tiles={tiles} loading={library === undefined} />
          </View>
          {wide ? <ThisWeek stats={stats} beside={beside} /> : null}
        </View>

        {recents.length > 0 ? (
          <View style={styles.stack}>
            <SectionHead
              title="Recently played"
              action={{ label: 'Library', onPress: () => router.navigate('/library') }}
            />
            <Recents songs={recents} wide={wide} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

/** The phone's header: the + that opens Import, and the avatar that opens Profile. */
function PhoneHeader(): ReactNode {
  const router = useRouter()
  const account = useAccount()
  return (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <IconButton
          testID="home-import"
          label="Import a link"
          filled
          onPress={() => router.navigate('/import')}
        >
          <Plus size={18} tone="textPrimary" />
        </IconButton>
        <Pressable
          testID="home-you"
          onPress={() => router.navigate('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <Avatar account={account} size={AVATAR} />
        </Pressable>
      </View>
    </View>
  )
}

/** One field that looks like a box to type in and opens search. */
function SearchField({ wide, onPress }: { wide: boolean; onPress: () => void }): ReactNode {
  const press = usePressScale(0.98)
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID="home-search"
        onPress={onPress}
        {...press.handlers}
        accessibilityRole="search"
        accessibilityLabel="Search"
        style={[styles.search, wide && styles.searchWide]}
      >
        <Search size={18} tone="textSecondary" />
        <Text style={styles.searchHint} numberOfLines={1}>
          {wide ? 'One song, a tag, an artist, a lyric…' : 'One song, an artist, a lyric…'}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

function SectionHead({
  title,
  action,
  testID,
}: {
  title: string
  action: { label: string; onPress: () => void } | null
  testID?: string
}): ReactNode {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="link" hitSlop={8} testID={testID}>
          <Text style={styles.linkSmall}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** The tiles, two across on a phone and three on a computer. A tile opens its tag's page. */
function Tiles({ tiles, loading }: { tiles: readonly HomeTile[]; loading: boolean }): ReactNode {
  // The width is the layout's to answer, not something to hand down three
  // components; `artFor` stays a prop on purpose, so the grid keeps one
  // watcher for its covers rather than one per tile.
  const { wide } = useLayout()
  const router = useRouter()
  const art = useArt()
  // A tile is a column of the grid however many there are: one tag is half a
  // row on a phone, not the whole of it.
  const rowWidth = useTilesRowWidth(wide)
  const columns = wide ? 3 : 2
  const tileWidth = rowWidth > 0 ? (rowWidth - TILE_GAP * (columns - 1)) / columns : undefined
  if (loading) return <View style={styles.tilesPlaceholder} />
  if (tiles.length === 0) {
    return (
      <View style={styles.emptyTile} testID="home-no-tags">
        <Text style={styles.emptyTitle}>Your tags will live here</Text>
        <Text style={styles.emptyBody}>
          Hold a song in Library and choose Tags to give it its first one.
        </Text>
      </View>
    )
  }
  return (
    <TileGrid
      tiles={tiles}
      width={tileWidth}
      artFor={tile => (tile.cover ? art(tile.cover) : null)}
      onOpen={tile => router.navigate(tagLink(tile.tag.name))}
    />
  )
}

/**
 * The grid itself, mounted the first time there are tiles to draw. That
 * mount, once a session, is when they fade up 60 ms apart (`M1`, 4); a tab
 * switch or coming back to Home finds them already there, so the welcome
 * never turns into a wait.
 */
function TileGrid({
  tiles,
  width,
  artFor,
  onOpen,
}: {
  tiles: readonly HomeTile[]
  width: number | undefined
  artFor: (tile: HomeTile) => string | null
  onOpen: (tile: HomeTile) => void
}): ReactNode {
  const [arrive] = useState(() => session.first('home-tiles'))
  return (
    <View style={styles.tiles}>
      {tiles.map((tile, index) => (
        <Tile
          key={tile.tag.id}
          tile={tile}
          index={index}
          arrive={arrive}
          width={width}
          artUri={artFor(tile)}
          onPress={() => onOpen(tile)}
        />
      ))}
    </View>
  )
}

function Tile({
  tile,
  index,
  arrive,
  width,
  artUri,
  onPress,
}: {
  tile: HomeTile
  index: number
  /** Whether this paint is the one the tiles fade up in. */
  arrive: boolean
  /** Unknown for the first frame, before the row has been measured. */
  width: number | undefined
  artUri: string | null
  onPress: () => void
}): ReactNode {
  const { wide } = useLayout()
  const press = usePressScale()
  const arrival = useArrival(index, arrive)
  const colours = tagColors(tile.tag.hue)
  return (
    // Two views, because the arrival and the press each carry a transform.
    <Animated.View style={arrival}>
      <Animated.View style={[{ width }, width === undefined && styles.tileUnmeasured, press.style]}>
        <Pressable
          testID={`home-tile-${index}`}
          onPress={onPress}
          {...press.handlers}
          accessibilityRole="button"
          accessibilityLabel={`${tile.tag.name}, ${plural(tile.songs, 'song', 'songs')}`}
          style={[styles.tile, wide && styles.tileWide, { backgroundColor: colours.tile }]}
        >
          <Text
            style={[
              styles.tileName,
              width !== undefined && width < SMALL_TILE && styles.tileNameSmall,
              { color: colours.tileInk },
            ]}
            numberOfLines={1}
          >
            {tile.tag.name}
          </Text>
          <Text style={[styles.tileCount, { color: colours.tileInk }]}>
            {tile.songs} {tile.songs === 1 ? 'song' : 'songs'}
          </Text>
          {tile.cover ? (
            <View style={[styles.tileCover, wide && styles.tileCoverWide]} pointerEvents="none">
              <Cover
                uri={artUri}
                title={tile.cover.album || tile.cover.title}
                size={wide ? 64 : 58}
                radius={12}
              />
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  )
}

/** Recently played: covers in a row that scrolls sideways. A tap plays from here. */
function Recents({ songs, wide }: { songs: readonly Song[]; wide: boolean }): ReactNode {
  const player = usePlayer()
  const art = useArt()
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const size = wide ? 132 : 92
  const drag = useDragScroll()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.recents}
      testID="home-recents"
      {...drag}
    >
      {songs.map((song, index) => (
        <Pressable
          key={song.id}
          testID={`home-recent-${index}`}
          onPress={() => player.playFrom(ids, index)}
          accessibilityRole="button"
          accessibilityLabel={`Play ${song.title}`}
          style={{ width: size }}
        >
          <Cover uri={art(song)} title={song.album || song.title} size={size} radius={14} />
          <Text style={styles.recentTitle} numberOfLines={1}>
            {song.title}
          </Text>
          {wide ? (
            <Text style={styles.recentArtist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  )
}

/** "2h 14": hours and minutes, the way the mock writes time listened. */
function listened(minutes: number): { big: string; small: string } {
  const whole = Math.round(minutes)
  if (whole < 60) return { big: String(whole), small: 'min' }
  return { big: `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}`, small: '' }
}

/**
 * A computer's card beside the tiles, or under them on a narrow page: this
 * week in three numbers, and the way to Stats.
 */
function ThisWeek({ stats, beside }: { stats: Stats | undefined; beside: boolean }): ReactNode {
  const router = useRouter()
  const column = beside ? styles.sideColumn : styles.stack
  if (!stats) return <View style={column} />
  const time = listened(stats.totals.minutes)
  // Under the tiles the two cards sit abreast, each half the page (`T02`).
  const cards = beside ? styles.cardsStacked : styles.cardsAbreast
  const half = beside ? null : styles.cardHalf
  return (
    <View style={column}>
      <SectionHead title="This week" action={null} />
      <View style={cards}>
        <View style={[styles.weekCard, half]} testID="home-this-week">
          <View style={styles.weekNumbers}>
            <Figure value={time.big} unit={time.small} caption="listened" />
            <Figure value={String(stats.totals.plays)} unit="" caption="plays" />
            {/* "2 days", not "2 d": the unit is set small, so it fits (Xiao). */}
            <Figure
              value={String(stats.streakDays)}
              unit={stats.streakDays === 1 ? 'day' : 'days'}
              caption="streak"
            />
          </View>
          <Pressable onPress={() => router.navigate('/stats')} accessibilityRole="link">
            <Text style={styles.linkSmall}>Stats and report</Text>
          </Pressable>
        </View>
        <ImportsHint style={half} />
      </View>
    </View>
  )
}

function Figure({
  value,
  unit,
  caption,
}: {
  value: string
  unit: string
  caption: string
}): ReactNode {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue}>
        {value}
        {unit ? <Text style={styles.figureUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.figureCaption}>{caption}</Text>
    </View>
  )
}

/** A quiet way to Import from the card column; the sidebar has the row as well. */
function ImportsHint({ style }: { style?: ViewStyle | null }): ReactNode {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.navigate('/import')}
      accessibilityRole="link"
      style={[styles.importCard, style]}
    >
      <View style={styles.importIcon}>
        <Download size={16} tone="textPrimary" />
      </View>
      <View style={styles.importText}>
        <Text style={styles.importTitle}>Import a link</Text>
        <Text style={styles.importBody}>A song or a playlist from YouTube</Text>
      </View>
    </Pressable>
  )
}

/** The round mark that opens Profile, in the phone's header. */
const AVATAR = 36

/** Between two tiles, across and down. */
const TILE_GAP = 10
/** A tile narrower than this (Slide Over's 320, `T08`) sets its name a size down. */
const SMALL_TILE = 140

/** The page's side gutters, the widest a computer's page grows, and the card column beside the tiles. */
const GUTTER_NARROW = 20
const GUTTER_WIDE = 48
const PAGE_MAX = 1040
const SIDE_COLUMN = 300
const COLUMN_GAP = 30
/**
 * The narrowest page that keeps the card column beside the tiles. Below it (an
 * iPad in portrait, a narrow window) the cards go under the tiles, which then
 * take the page's whole width rather than a sliver of it.
 */
const BESIDE_MIN = 880

/** Whether the card column sits beside the tiles, or under them. */
function useCardsBeside(wide: boolean): boolean {
  const column = useContentWidth()
  return wide && (column === null || Math.min(column, PAGE_MAX) >= BESIDE_MIN)
}

/**
 * How wide the row of tiles is, worked out from the page rather than
 * measured: the window on a phone, the page column beside the sidebar on a
 * computer, less the gutters and, there, the card column.
 */
function useTilesRowWidth(wide: boolean): number {
  // The app's own width, not the window's: an iPad in Split View is handed
  // half the screen and told about the whole of it (`shell/rootWidth.ts`).
  const { width } = useLayout()
  const column = useContentWidth()
  if (!wide) return Math.floor(width - GUTTER_NARROW * 2)
  if (column === null) return 0
  const page = Math.min(column, PAGE_MAX)
  const cards = page >= BESIDE_MIN ? SIDE_COLUMN + COLUMN_GAP : 0
  return Math.floor(page - GUTTER_WIDE * 2 - cards)
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { gap: 22 },
  contentNarrow: { paddingHorizontal: GUTTER_NARROW, paddingTop: 4 },
  contentWide: {
    paddingHorizontal: GUTTER_WIDE,
    paddingTop: 40,
    maxWidth: PAGE_MAX,
    width: '100%',
  },
  stack: { gap: 10 },
  cardsStacked: { gap: 12 },
  cardsAbreast: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  cardHalf: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  columns: { flexDirection: 'row', gap: COLUMN_GAP, alignItems: 'flex-start' },
  mainColumn: { flex: 1, minWidth: 0, gap: 12 },
  sideColumn: { width: SIDE_COLUMN, gap: 12 },
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greetingBlock: { gap: 4, paddingTop: 14 },
  greeting: { ...serif(theme.colors, type.display), lineHeight: 50, letterSpacing: -0.5 },
  greetingDot: { fontFamily: fonts.serifItalic, color: theme.colors.accent },
  subline: { color: theme.colors.textSecondary, fontSize: 15 },
  // The Sunday card (`P06`): the week, as a card, under the greeting.
  sunday: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  sundayPressed: { backgroundColor: theme.colors.surface2 },
  sundayText: { flex: 1, minWidth: 0, gap: 2 },
  sundayTitle: sectionTitle(theme.colors),
  sundayLine: { color: theme.colors.textSecondary, fontSize: 13 },
  search: {
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  searchWide: { height: 48 },
  searchHint: { flex: 1, color: theme.colors.textMuted, fontSize: 16 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: sectionTitle(theme.colors),
  linkSmall: { color: theme.colors.accent, fontSize: 13, fontWeight: '600' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  tileUnmeasured: { opacity: 0 },
  tile: {
    height: 98,
    borderRadius: radius.card,
    padding: 14,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  tileWide: { height: 118, padding: 16 },
  tileName: {
    fontFamily: fonts.display,
    fontSize: type.tile,
    letterSpacing: -0.3,
    paddingRight: 36,
  },
  tileNameSmall: { fontSize: type.tile - 3 },
  tileCount: { fontSize: 12, fontWeight: '500' },
  tileCover: {
    position: 'absolute',
    right: -8,
    bottom: -10,
    transform: [{ rotate: '8deg' }],
    ...artShadow(theme.colors, 'lean'),
    borderRadius: 12,
  },
  tileCoverWide: { right: -6, bottom: -8 },
  tilesPlaceholder: { height: 206 },
  emptyTile: {
    ...card(theme.colors),
    padding: 18,
    gap: 6,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: type.section,
    color: theme.colors.textPrimary,
  },
  emptyBody: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  recents: { gap: 10, paddingRight: 20 },
  recentTitle: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  recentArtist: { color: theme.colors.textSecondary, fontSize: 12 },
  weekCard: { ...card(theme.colors, radius.cardLg), padding: 18, gap: 14 },
  weekNumbers: { flexDirection: 'row', justifyContent: 'space-between' },
  figure: { gap: 2 },
  figureValue: serif(theme.colors, 30),
  figureUnit: { fontFamily: fonts.serif, fontSize: 18, color: theme.colors.textSecondary },
  figureCaption: { color: theme.colors.textSecondary, fontSize: 12 },
  importCard: {
    ...card(theme.colors),
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  importIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importText: { flex: 1, gap: 2 },
  importTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  importBody: { color: theme.colors.textSecondary, fontSize: 12 },
}))
