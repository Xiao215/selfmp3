import { useEffect, useId, useMemo, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, ScrollView, Text, View } from 'react-native'
import type { ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useRouter, type Href } from 'expo-router'
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
import { ChevronRight, Download, Plus, Search, Sparkle } from '../../ui/components/Icons'
import { useAccent } from '../../ui/accent'
import { useSongColor } from '../../ui/useSongColor'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { session, useArrival, usePressScale } from '../../ui/motion'
import { handOffPlace } from '../../ui/coverHandoff'
import { artShadow, card, sectionTitle, serif } from '../../ui/surfaces'
import { tagFromTileLink } from '../tag/placeLinks'
import { PlaylistCover } from '../playlists/PlaylistCover'
import {
  describeSource,
  homeRecents,
  recentKind,
  recentSongIds,
  type HomeRecent,
} from '../lists/lists.model'
import { useRecentLists } from '../lists/recentLists.store'
import { keepAnswer, reorderAnswer } from '../smart/answers.store'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { useStatsFor } from '../stats/statsSource'
import {
  greeting,
  HOME_TILES,
  HOME_TILES_WIDE,
  homeTiles,
  streakLine,
  sundayCard,
  type HomeTile,
  type SundayCard,
} from './home.model'

/**
 * Home: where the app opens (docs/ui-mock `P04`, `C03`).
 *
 * A greeting and one quiet line, one search field, the tags you play most as
 * tiles, and what you played last. On a phone the header carries the + that
 * opens Import and the avatar that opens Profile; a computer has those in its
 * sidebar, and adds this week's numbers beside the tiles. No date line: the
 * greeting under it already says what time of day it is (Xiao, 2026-09-20).
 *
 * Stats come from the server, as they do on the Stats page: a cloud library has
 * a streak to show only while its server is within reach, and shows none
 * otherwise rather than a zero.
 *
 * A library with no songs at all gets one card in place of the tags and the
 * search: the way to the first song, and what the page turns into once there
 * is one. "Hold a song in Library and choose Tags" over no songs was a puzzle
 * (Xiao, 2026-09-22).
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
  const recentLists = useRecentLists()
  const recents = useMemo(
    () => (library ? homeRecents(recentLists, library.songs) : []),
    [library, recentLists],
  )
  const line = streakLine(stats?.streakDays)
  const sunday = sundayCard(now, stats)
  const sundayId = sunday?.song?.songId
  const sundaySong = useMemo(
    () => (sundayId === undefined ? null : (library?.songs.find(s => s.id === sundayId) ?? null)),
    [library, sundayId],
  )
  const openWeek = (): void =>
    router.navigate({ pathname: '/stats/report', params: { range: 'week' } })
  // Known to be empty, as opposed to not loaded yet.
  const empty = library !== undefined && library.songs.length === 0

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

        {/* A computer says it in This week instead, beside the tiles, where the
            same numbers already were (`F`, Xiao 2026-10-04). */}
        {sunday && !wide ? <SundayLead card={sunday} song={sundaySong} onOpen={openWeek} /> : null}

        {empty ? null : <SearchField wide={wide} onPress={openSearch} />}

        <View style={beside ? styles.columns : styles.stack}>
          <View style={beside ? styles.mainColumn : styles.stack}>
            {empty ? (
              <FirstSong onPress={() => router.navigate('/import')} />
            ) : (
              <>
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
              </>
            )}
          </View>
          {wide ? (
            <ThisWeek
              stats={stats}
              beside={beside}
              sunday={sunday}
              sundaySong={sundaySong}
              onOpenWeek={openWeek}
            />
          ) : null}
        </View>

        {recents.length > 0 ? (
          <View style={styles.stack}>
            <SectionHead
              title="Recently played"
              action={{ label: 'Library', onPress: () => router.navigate('/library') }}
            />
            <Recents recents={recents} wide={wide} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The Sunday card on a phone (`P06`, E): led by the week's number one, its
 * cover large and the card washed in that cover's colour, so every Sunday
 * looks like its own week. A tap opens the week as a page. Without a song to
 * lead it, it says the week in the accent.
 */
function SundayLead({
  card,
  song,
  onOpen,
}: {
  card: SundayCard
  /** The number one in the library, for its cover and colour; null if it has gone. */
  song: Song | null
  onOpen: () => void
}): ReactNode {
  const tone = useSundayTone(song)
  const press = usePressScale(0.98)
  const lead = card.song
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID="home-sunday"
        onPress={onOpen}
        {...press.handlers}
        accessibilityRole="link"
        accessibilityLabel={
          lead
            ? `${card.title}. ${lead.title}, ${lead.note}. ${card.line}`
            : `${card.title}. ${card.line}`
        }
        style={styles.sunday}
      >
        <ToneWash color={tone.color} />
        {song ? (
          <View style={styles.sundayCover}>
            <Cover
              uri={tone.uri}
              title={song.album || song.title}
              size={SUNDAY_COVER}
              radius={12}
            />
          </View>
        ) : null}
        {/* Without a song, the week says itself: the title, then how long and whose. */}
        <View style={styles.sundayText}>
          {lead ? <Text style={[styles.kicker, { color: tone.tint }]}>{card.title}</Text> : null}
          <Text style={styles.sundayTitle} numberOfLines={1}>
            {lead ? lead.title : card.title}
          </Text>
          <Text style={styles.sundayLine} numberOfLines={1}>
            {lead ? lead.note : card.line}
          </Text>
        </View>
        <ChevronRight size={16} color={tone.tint} />
      </Pressable>
    </Animated.View>
  )
}

/**
 * A song's colour washed across a card from the left and out to nothing on
 * the right, so the card reads as lit by its cover rather than painted.
 */
function ToneWash({ color }: { color: string }): ReactNode {
  // Gradient ids are document ids on the web: two cards must not share one.
  const id = `tone${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Pinned to the edges and a unit box stretched over it, as ProgressWash's fade is. */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0.34} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.1} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/**
 * The first thing on an empty library's Home: one card washed with the
 * accent, the way the New playlist tile is, that opens Import. It says what
 * Home becomes once a song is in, so the space is a promise rather than a gap.
 */
function FirstSong({ onPress }: { onPress: () => void }): ReactNode {
  const accent = useAccent()
  const press = usePressScale(0.98)
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID="home-first-song"
        onPress={onPress}
        {...press.handlers}
        accessibilityRole="button"
        accessibilityLabel="Import a link. Silence, for now: paste a YouTube link and your library starts here."
        style={[styles.firstCard, { backgroundColor: accent.accentPill }]}
      >
        <View style={styles.firstMark}>
          <Plus size={22} color={accent.accent} />
        </View>
        <Text style={styles.firstTitle}>
          Silence, for now
          <Text style={styles.greetingDot}>.</Text>
        </Text>
        <Text style={styles.firstBody}>
          Paste a YouTube link and your library starts here. The tags you play most, what you played
          last and your week in numbers all follow from the first song.
        </Text>
        <View style={styles.firstAction}>
          <Text style={[styles.firstActionLabel, { color: accent.accent }]}>Import a link</Text>
          <ChevronRight size={16} color={accent.accent} />
        </View>
      </Pressable>
    </Animated.View>
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
  // row on a phone, not the whole of it. The columns share the row by flex,
  // so a tile is as wide as the layout makes it on every frame; the number is
  // only for the name's size, which may follow a frame behind.
  const rowWidth = useTilesRowWidth(wide)
  const columns = wide ? 3 : 2
  const small = rowWidth > 0 && (rowWidth - TILE_GAP * (columns - 1)) / columns < SMALL_TILE
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
      columns={columns}
      small={small}
      artFor={tile => (tile.cover ? art(tile.cover) : null)}
      onOpen={tile => router.navigate(tagFromTileLink(tile.tag.name))}
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
  columns,
  small,
  artFor,
  onOpen,
}: {
  tiles: readonly HomeTile[]
  columns: number
  /** Whether a tile is narrower than `SMALL_TILE`, and its name a size down. */
  small: boolean
  artFor: (tile: HomeTile) => string | null | undefined
  onOpen: (tile: HomeTile) => void
}): ReactNode {
  const [arrive] = useState(() => session.first('home-tiles'))
  /*
   * Rows of `columns`, each tile a flex column of its row, and blank cells
   * filling out the last row so a lone tile keeps a column's width. Sized by
   * the row rather than by a number: a width worked out in JavaScript arrives
   * a frame after the layout it was worked out from, and while a window was
   * being dragged narrower the tiles kept the old width for that frame and
   * lay across the card column beside them (Xiao's recording, 2026-09-23).
   */
  const rows: HomeTile[][] = []
  for (let start = 0; start < tiles.length; start += columns)
    rows.push(tiles.slice(start, start + columns))
  return (
    <View style={styles.tiles}>
      {rows.map((row, rowIndex) => (
        <View key={row[0]?.tag.id ?? rowIndex} style={styles.tileRow}>
          {row.map((tile, column) => (
            <Tile
              key={tile.tag.id}
              tile={tile}
              index={rowIndex * columns + column}
              count={tiles.length}
              arrive={arrive}
              small={small}
              artUri={artFor(tile)}
              onPress={() => onOpen(tile)}
            />
          ))}
          {Array.from({ length: columns - row.length }, (_, blank) => (
            <View key={`blank-${blank}`} style={styles.tileCell} />
          ))}
        </View>
      ))}
    </View>
  )
}

function Tile({
  tile,
  index,
  count,
  arrive,
  small,
  artUri,
  onPress,
}: {
  tile: HomeTile
  index: number
  /** How many tiles there are, so a long grid's stagger closes up. */
  count: number
  /** Whether this paint is the one the tiles fade up in. */
  arrive: boolean
  small: boolean
  artUri: string | null | undefined
  onPress: () => void
}): ReactNode {
  const { wide } = useLayout()
  const press = usePressScale()
  const arrival = useArrival(index, arrive, count)
  const colours = tagColors(tile.tag.hue)
  const ref = useRef<View>(null)
  // Where the tile is, for the tag's head to grow from (`M2`, 2).
  const open = (): void => {
    const node = ref.current
    if (!node) {
      onPress()
      return
    }
    node.measureInWindow((x, y, width, height) => {
      handOffPlace({ x, y, width, height })
      onPress()
    })
  }
  return (
    // Two views, because the arrival and the press each carry a transform.
    <Animated.View style={[styles.tileCell, arrival]}>
      <Animated.View style={press.style}>
        <Pressable
          ref={ref}
          testID={`home-tile-${index}`}
          onPress={open}
          {...press.handlers}
          accessibilityRole="button"
          accessibilityLabel={`${tile.tag.name}, ${plural(tile.songs, 'song', 'songs')}`}
          style={[styles.tile, wide && styles.tileWide, { backgroundColor: colours.tile }]}
        >
          <Text
            style={[styles.tileName, small && styles.tileNameSmall, { color: colours.tileInk }]}
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

/**
 * Recently played (docs/features/lists.md, A1): what you listened to, newest
 * first, in a row that scrolls sideways — a list as its covers and its kind,
 * a song played on its own as that song. A tap plays it again; a list that
 * was never saved can be saved from Up next.
 */
function Recents({ recents, wide }: { recents: readonly HomeRecent[]; wide: boolean }): ReactNode {
  const player = usePlayer()
  const router = useRouter()
  const art = useArt()
  const { data: library } = useLibrary()
  const size = wide ? 132 : 92
  const drag = useDragScroll()
  const songIds = useMemo(
    () => recents.flatMap(recent => (recent.kind === 'song' ? [recent.song.id] : [])),
    [recents],
  )
  const known = { tags: library?.tags ?? [], playlists: library?.playlists ?? [] }
  const fly = useFlyToUpNext()
  // Each list tile's covers, where a played list's covers fly from.
  const covers = useRef(new Map<string, View>())
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.recents}
      testID="home-recents"
      {...drag}
    >
      {recents.map((recent, index) => {
        if (recent.kind === 'song') {
          const song = recent.song
          return (
            <Pressable
              key={`song-${song.id}`}
              testID={`home-recent-${index}`}
              onPress={() => player.playFrom(songIds, songIds.indexOf(song.id))}
              accessibilityRole="button"
              accessibilityLabel={`Play ${song.title}`}
              style={{ width: size }}
            >
              <Cover uri={art(song)} title={song.album || song.title} size={size} radius={14} />
              <Text style={styles.recentTitle} numberOfLines={1}>
                {song.title}
              </Text>
              <Text style={styles.recentArtist} numberOfLines={1}>
                {song.artist || 'Unknown artist'}
              </Text>
            </Pressable>
          )
        }
        const { entry } = recent
        const line = describeSource(entry.source, known)
        return (
          <Pressable
            key={entry.key}
            testID={`home-recent-${index}`}
            onPress={() => {
              // A list opens, as any list's tile does; playing it is its page's Play.
              if (line.link) {
                router.push(line.link as unknown as Href)
                return
              }
              if (entry.source.kind === 'answer' && entry.answer) {
                const id = keepAnswer(entry.source.text, entry.answer)
                reorderAnswer(id, entry.songIds)
                router.push({ pathname: '/answer', params: { id } })
                return
              }
              // Songs that are no place of their own (similar ones, ones you
              // picked): there is no page to open, so they play.
              if (!library) return
              const ids = recentSongIds(entry, library)
              if (ids.length === 0) return
              fly(covers.current.get(entry.key) ?? null, ids)
              player.playFrom(ids, 0, { source: entry.source })
            }}
            accessibilityRole="button"
            accessibilityLabel={
              line.link || entry.answer ? `Open ${line.label}` : `Play ${line.label}`
            }
            style={{ width: size }}
          >
            <View
              collapsable={false}
              ref={node => {
                if (node) covers.current.set(entry.key, node)
                else covers.current.delete(entry.key)
              }}
            >
              <PlaylistCover songIds={entry.songIds} size={size} />
              {line.asked ? (
                <View style={styles.recentBadge}>
                  <Sparkle size={11} />
                </View>
              ) : null}
            </View>
            <Text style={styles.recentTitle} numberOfLines={1}>
              {line.label}
            </Text>
            <Text style={styles.recentArtist} numberOfLines={1}>
              {recentKind(entry.source)}
            </Text>
          </Pressable>
        )
      })}
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
 * week in three numbers, and the way to Stats. On a Sunday it is also the way
 * into the week as a page (`F`, Xiao 2026-10-04): the week's number one at its
 * head, the card washed in its cover's colour, and a button that opens the
 * week. Home's top keeps to the greeting and the search, rather than a bar
 * over these same numbers.
 */
function ThisWeek({
  stats,
  beside,
  sunday,
  sundaySong,
  onOpenWeek,
}: {
  stats: Stats | undefined
  beside: boolean
  sunday: SundayCard | null
  sundaySong: Song | null
  onOpenWeek: () => void
}): ReactNode {
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
          {sunday ? <WeekReadyHead card={sunday} song={sundaySong} /> : null}
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
          {sunday ? (
            <OpenWeek card={sunday} song={sundaySong} onOpen={onOpenWeek} />
          ) : (
            <Pressable onPress={() => router.navigate('/stats')} accessibilityRole="link">
              <Text style={styles.linkSmall}>Stats and report</Text>
            </Pressable>
          )}
        </View>
        <ImportsHint style={half} />
      </View>
    </View>
  )
}

/** The colours of the week's number one: its cover's, or the accent without one. */
function useSundayTone(song: Song | null): {
  uri: string | null | undefined
  tint: string
  color: string
} {
  const art = useArt()
  const uri = song ? art(song) : null
  return { uri, ...useSongColor(song, uri) }
}

/**
 * This week's head on a Sunday: the number one, over a wash of its cover's
 * colour that goes under the whole card, so it is drawn first.
 */
function WeekReadyHead({ card, song }: { card: SundayCard; song: Song | null }): ReactNode {
  const tone = useSundayTone(song)
  const lead = card.song
  return (
    <>
      <ToneWash color={tone.color} />
      <View style={styles.readyHead}>
        {song ? (
          <View style={styles.readyCover}>
            <Cover uri={tone.uri} title={song.album || song.title} size={READY_COVER} radius={10} />
          </View>
        ) : null}
        <View style={styles.sundayText}>
          <Text style={[styles.kicker, { color: tone.tint }]}>{card.title}</Text>
          {lead ? (
            <Text style={styles.readyTitle} numberOfLines={1}>
              {lead.title}
            </Text>
          ) : null}
        </View>
      </View>
    </>
  )
}

/** And its foot: the button that opens the week, in the song's colour. */
function OpenWeek({
  card,
  song,
  onOpen,
}: {
  card: SundayCard
  song: Song | null
  onOpen: () => void
}): ReactNode {
  const tone = useSundayTone(song)
  const lead = card.song
  return (
    <Pressable
      testID="home-sunday"
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={lead ? `Open your week. ${lead.title}, ${lead.note}.` : 'Open your week'}
      style={({ pressed }) => [
        styles.readyButton,
        { backgroundColor: tone.tint },
        pressed && styles.readyButtonPressed,
      ]}
    >
      <Text style={styles.readyButtonLabel}>Open your week</Text>
    </Pressable>
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

/** The week's number one: on the phone's Sunday card, and at This week's head. */
const SUNDAY_COVER = 76
const READY_COVER = 52

/** Between two tiles, across and down. */
const TILE_GAP = 10
/** A tile narrower than this (Slide Over's 320, `T08`) sets its name a size down. */
const SMALL_TILE = 140

/** The page's side gutters, and the card column beside the tiles. */
const GUTTER_NARROW = 20
const GUTTER_WIDE = 48
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
  return wide && (column === null || column >= BESIDE_MIN)
}

/**
 * How wide the row of tiles is, worked out from the page rather than
 * measured: the window on a phone, the page column beside the sidebar on a
 * computer, less the gutters and, there, the card column. The tiles are laid
 * out by flex and never told this; it only decides how large a name is set.
 */
function useTilesRowWidth(wide: boolean): number {
  // The app's own width, not the window's: an iPad in Split View is handed
  // half the screen and told about the whole of it (`shell/rootWidth.ts`).
  const { width } = useLayout()
  const column = useContentWidth()
  if (!wide) return Math.floor(width - GUTTER_NARROW * 2)
  if (column === null) return 0
  const cards = column >= BESIDE_MIN ? SIDE_COLUMN + COLUMN_GAP : 0
  return Math.floor(column - GUTTER_WIDE * 2 - cards)
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { gap: 22 },
  contentNarrow: { paddingHorizontal: GUTTER_NARROW, paddingTop: 4 },
  contentWide: { paddingHorizontal: GUTTER_WIDE, paddingTop: 40 },
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
  // The Sunday card (`P06`, E): the week's number one, under the greeting.
  sunday: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    overflow: 'hidden',
  },
  sundayCover: { ...artShadow(theme.colors, 'lean'), borderRadius: 12 },
  sundayText: { flex: 1, minWidth: 0, gap: 3 },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  sundayTitle: { ...sectionTitle(theme.colors), fontSize: 17 },
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
  tiles: { gap: TILE_GAP },
  tileRow: { flexDirection: 'row', gap: TILE_GAP },
  tileCell: { flex: 1, minWidth: 0 },
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
  firstCard: {
    borderRadius: radius.cardLg,
    padding: 22,
    gap: 10,
    alignItems: 'flex-start',
  },
  firstMark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  firstTitle: { ...serif(theme.colors, 28), lineHeight: 34, letterSpacing: -0.3 },
  firstBody: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, maxWidth: 440 },
  firstAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  firstActionLabel: { fontSize: 14, fontWeight: '600' },
  recents: { gap: 10, paddingRight: 20 },
  recentTitle: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  recentArtist: { color: theme.colors.textSecondary, fontSize: 12 },
  recentBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekCard: { ...card(theme.colors, radius.cardLg), padding: 18, gap: 14, overflow: 'hidden' },
  readyHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  readyCover: { ...artShadow(theme.colors, 'lean'), borderRadius: 10 },
  readyTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  readyButton: {
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyButtonPressed: { opacity: 0.85 },
  readyButtonLabel: { color: theme.colors.surface0, fontSize: 13, fontWeight: '600' },
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
