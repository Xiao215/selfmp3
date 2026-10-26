import { useEffect, useMemo, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { plural } from '@selfmp3/shared'
import { pastRoomFaces, useRecentRooms } from '../room/pastRooms.store'
import { FacesCover } from '../room/RoomFace'
import { usePastRoomCovers } from '../room/usePastRoomCovers'
import { HomeTogetherButton } from '../room/Together'
import { useResumeSharedJoin } from '../shared/SharedScreens'
import type { PastRoom } from '../room/room.model'
import type { Song, Stats } from '@selfmp3/shared'
import {
  radius,
  tagColors,
  type,
  useLibrary,
  textStyle,
  tracking,
  iconSize,
  space,
} from '@selfmp3/client'
import { fonts } from '../../ports/fonts'
import { useArt } from '../../offline/useArt'
import { Avatar } from '../../ui/components/Avatar'
import { useAccount } from '../profile/useAccount'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useOpenSearch } from '../../shell/palette'
import { useBottomInset } from '../../shell/bottomInset'
import { useContentWidth, useContentWidthValue } from '../../shell/contentWidth'
import { useLayout, useLayoutFlags, useLayoutValue } from '../../shell/useLayout'
import { Cover } from '../../ui/components/Cover'
import { EmptyState } from '../../ui/components/EmptyState'
import { Bone, Skeleton } from '../../ui/components/Skeleton'
import { Press } from '../../ui/components/Press'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { SearchField } from '../../ui/components/SearchField'
import { SectionHead } from '../../ui/components/SectionHead'
import { Shelf, ShelfCard, SongCard } from '../../ui/components/Shelf'
import { FromFriends, ShareAsks } from '../share/FromFriends'
import { TileGrid, useTileGrid } from '../../ui/components/TileGrid'
import { ChevronRight, Download, Sparkle } from '../../ui/components/Icons'
import { useAccent } from '../../ui/accent'
import { useSongColor } from '../../ui/useSongColor'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { session, useArrival } from '../../ui/motion'
import { handOffPlace } from '../../ui/coverHandoff'
import {
  artShadow,
  card,
  pageFrame,
  sectionTitle,
  serif,
  rowTitle,
  nameTitle,
  label,
} from '../../ui/surfaces'
import { useOpenTag } from '../tag/useOpenTag'
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
import { useStatsFor, useStatsSongs } from '../stats/statsSource'
import { statFigures } from '../stats/stats.model'
import { StatFigure, StatFigures } from '../../ui/components/StatFigure'
import {
  greeting,
  HOME_TILES,
  HOME_TILES_WIDE,
  homeTiles,
  streakLine,
  sundayCard,
  sundaySpoken,
  type HomeTile,
  type SundayCard,
} from './home.model'
import { useSvgId } from '../../ui/useSvgId'
import { useVia } from '../../connection/via'
import { ScrollView } from '../../ui/components/Scroll'
import { COLUMN_WIDTH } from '../../shell/widths'
import { CantReach } from '../library/CantReach'

/**
 * Home: where the app opens (docs/ui-mock `P04`, `C03`).
 *
 * A greeting and one quiet line, one search field, the tags you play most as
 * tiles, and what you played last. On a phone the header carries Import's
 * download arrow and the avatar that opens Profile; a computer has those in
 * its sidebar, and its search too, so its Home has no field of its own (A1,
 * Xiao 2026-10-25); it adds this week's numbers beside the tiles instead. No date line: the
 * greeting under it already says what time of day it is (Xiao, 2026-09-20).
 *
 * Stats come from the server, as they do on the Stats page: a cloud library has
 * a streak to show only while its server is within reach, and shows none
 * otherwise rather than a zero.
 *
 * A library with no songs at all gets one card in place of the tags and the
 * search: where the library starts, and the button to Import. "Hold a song in
 * Library and choose Tags" over no songs was a puzzle
 * (Xiao, 2026-09-22).
 */
export function HomeScreen(): ReactNode {
  // A shared playlist's invite opened before signing in (features/shared).
  useResumeSharedJoin()
  const via = useVia()
  const { data: stats } = useStatsFor(via, '7d')
  const songFor = useStatsSongs(via)
  return <HomePage stats={stats} songFor={songFor} />
}

/**
 * The clock, for the greeting and the Sunday card: both read only the hour
 * and the day, so a tick inside the same hour keeps the same Date and the page
 * is not drawn again for it.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => {
      const next = new Date()
      setNow(shown =>
        shown.getHours() === next.getHours() && shown.getDay() === next.getDay() ? shown : next,
      )
    }, 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function HomePage({
  stats,
  songFor,
}: {
  stats: Stats | undefined
  /** The song a stats id names, as this device knows it: the server's ids are not this library's. */
  songFor: (songId: number) => Song | undefined
}): ReactNode {
  const { wide } = useLayoutFlags()
  const beside = useCardsBeside(wide)
  const roomy = useLayoutValue(roomyPhone)
  const router = useRouter()
  const now = useNow()
  const bottom = useBottomInset()
  const libraryQuery = useLibrary()
  const library = libraryQuery.data
  // Three by two wherever the tiles go three across.
  const many = wide || roomy
  const tiles = useMemo(
    () =>
      library ? homeTiles(library.tags, library.songs, many ? HOME_TILES_WIDE : HOME_TILES) : [],
    [library, many],
  )
  const recentLists = useRecentLists()
  // Rooms listened in together, for a few days after they end (features/room).
  const rooms = useRecentRooms()
  // As many as the row holds on a very wide page, rather than twelve and an
  // empty half of the row (P1 C); never fewer than the twelve it remembers.
  const recentsShown = useContentWidthValue(page =>
    page === null
      ? undefined
      : Math.max(
          RECENTS_LEAST,
          Math.floor((page - space.gutterWide * 2 + RECENT_GAP) / (RECENT_TILE + RECENT_GAP)),
        ),
  )
  const recents = useMemo(
    () => (library ? homeRecents(recentLists, library.songs, recentsShown) : []),
    [library, recentLists, recentsShown],
  )
  const line = streakLine(stats?.streakDays)
  const sunday = sundayCard(now, stats)
  const sundayId = sunday?.song?.songId
  const sundaySong = useMemo(
    () => (sundayId === undefined ? null : (songFor(sundayId) ?? null)),
    [songFor, sundayId],
  )
  const openWeek = (): void =>
    router.navigate({ pathname: '/stats/report', params: { range: 'week' } })
  // Known to be empty, as opposed to not loaded yet.
  const empty = library !== undefined && library.songs.length === 0

  // The one Search, starting on All: the page on a phone, the palette over
  // this page on a computer (docs/ui-mock `P18`, `C05`).
  const openSearch = useOpenSearch()

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

        <View style={[styles.greetingBlock, wide && styles.greetingBlockWide]}>
          <Text style={styles.greeting} accessibilityRole="header">
            {greeting(now.getHours())}
            <Text style={styles.greetingDot}>.</Text>
          </Text>
          {/* A computer's This week card says the streak already, beside the tiles. */}
          {line === null || wide ? null : <Text style={styles.subline}>{line}</Text>}
        </View>

        {/* A computer says it in This week instead, beside the tiles, where the
            same numbers already were (`F`, Xiao 2026-10-04). */}
        {sunday && !wide ? <SundayLead card={sunday} song={sundaySong} onOpen={openWeek} /> : null}

        {/* A door to the one Search, not a second place to type. A computer's
            is the sidebar's row, right beside this page. */}
        {empty || wide ? null : (
          <SearchField
            testID="home-search"
            onPress={openSearch}
            accessibilityLabel="Search"
            placeholder="One song, an artist, a lyric…"
          />
        )}

        <View style={beside ? styles.columns : styles.stack}>
          <View style={beside ? styles.mainColumn : styles.stack}>
            {empty ? (
              <>
                <FirstSong onPress={() => router.navigate('/import')} />
                <Text style={styles.weekLater} testID="home-week-later">
                  Your week shows here once you’ve played something.
                </Text>
              </>
            ) : (
              <>
                {/* The head's own action, as Recently played's is, rather than a
                    link under the tiles (Xiao, 2026-09-20). */}
                <SectionHead
                  testID="home-all-tags"
                  title="Your tags"
                  action={
                    library && library.tags.length > 0
                      ? {
                          label: 'See all',
                          onPress: () => router.navigate('/tags'),
                        }
                      : null
                  }
                />
                {/* No library and no copy of one: say why, as Library does, not an empty space. */}
                {library === undefined && libraryQuery.isError ? (
                  <CantReach
                    error={libraryQuery.error}
                    onRetry={() => void libraryQuery.refetch()}
                  />
                ) : (
                  <Tiles tiles={tiles} loading={library === undefined} beside={beside} />
                )}
              </>
            )}
          </View>
          {/* A new library has no week to show: no card of zeros, no second
              Import beside the first (Z1). */}
          {wide && !empty ? (
            <ThisWeek
              stats={stats}
              beside={beside}
              sunday={sunday}
              sundaySong={sundaySong}
              onOpenWeek={openWeek}
            />
          ) : null}
        </View>

        <ShareAsks />
        <FromFriends wide={wide} />

        {recents.length > 0 || rooms.length > 0 ? (
          <View style={styles.stack}>
            <SectionHead
              title="Recently played"
              action={{ label: 'See all', onPress: () => router.navigate('/library') }}
            />
            <Recents recents={recents} rooms={rooms} wide={wide} />
          </View>
        ) : library === undefined && recentLists.length > 0 ? (
          // Remembered on this device, so known to be coming before the songs
          // they name have arrived (AA1).
          <View style={styles.stack}>
            <SectionHead title="Recently played" action={null} />
            <RecentsWaiting wide={wide} />
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
  const lead = card.song
  return (
    <Press
      depth="row"
      testID="home-sunday"
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={sundaySpoken(card)}
      style={styles.sunday}
    >
      <ToneWash color={tone.color} />
      {song ? <SundaySong song={song} tone={tone} size={SUNDAY_COVER} /> : null}
      {/* Without a song, the week says itself: the title, then how long and whose. */}
      <View style={styles.sundayText}>
        {lead ? <Text style={[styles.kicker, { color: tone.tint }]}>{card.title}</Text> : null}
        {/* Two lines each, so large text wraps them rather than cutting "Song of the wee…" (AM1). */}
        <Text style={styles.sundayTitle} numberOfLines={2}>
          {lead ? lead.title : card.title}
        </Text>
        <Text style={styles.sundayLine} numberOfLines={2}>
          {lead ? lead.note : card.line}
        </Text>
      </View>
      <ChevronRight size={iconSize.item} color={tone.tint} />
    </Press>
  )
}

/**
 * A song's colour washed across a card from the left and out to nothing on
 * the right, so the card reads as lit by its cover rather than painted.
 * `diagonal` runs it from the top corner down into the card, deeper, for a
 * card the colour is the whole ground of (This week on a computer).
 */
function ToneWash({ color, diagonal = false }: { color: string; diagonal?: boolean }): ReactNode {
  // Gradient ids are document ids on the web: two cards must not share one.
  const id = useSvgId('tone')
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
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2={diagonal ? '1' : '0'}>
            <Stop offset="0" stopColor={color} stopOpacity={diagonal ? 0.42 : 0.34} />
            <Stop offset="0.55" stopColor={color} stopOpacity={diagonal ? 0.14 : 0.1} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/**
 * The first thing on an empty library's Home, and the only way in it offers:
 * one card washed with the accent, the way the New playlist tile is, saying
 * where the library starts and where songs come from, and the one button
 * that starts it.
 */
function FirstSong({ onPress }: { onPress: () => void }): ReactNode {
  const accent = useAccent()
  return (
    <View style={[styles.firstCard, { backgroundColor: accent.accentPill }]} testID="home-first">
      <Text style={styles.firstTitle} accessibilityRole="header">
        Your library starts with one song
        <Text style={styles.greetingDot}>.</Text>
      </Text>
      <Text style={styles.firstLine}>
        Paste a link from YouTube, 网易云音乐 or Spotify, or search for a song.
      </Text>
      <View style={styles.firstAction}>
        <Button
          label="Import a song"
          variant="primary"
          icon={<Download tone="onAccent" />}
          onPress={onPress}
          testID="home-first-song"
        />
      </View>
    </View>
  )
}

/**
 * The phone's header: Import, as the download arrow the computer's sidebar
 * gives it (M2) — a + everywhere else means a new playlist or tag — and the
 * avatar that opens Profile.
 */
function PhoneHeader(): ReactNode {
  const router = useRouter()
  const account = useAccount()
  return (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <HomeTogetherButton />
        <IconButton
          testID="home-import"
          label="Import"
          filled
          onPress={() => router.navigate('/import')}
        >
          <Download tone="textPrimary" />
        </IconButton>
        <Press
          testID="home-you"
          onPress={() => router.navigate('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <Avatar account={account} size={AVATAR} />
        </Press>
      </View>
    </View>
  )
}

/**
 * The tiles, two across on a phone and three on an iPad held upright; on a
 * computer as many as fit a tile of `WIDE_TILE_MIN`, two to three, so a page
 * narrowed by Up next drops a column rather than cutting the names (M1); more
 * on a very wide page, where three would each grow past `WIDE_TILE_MAX`. A
 * tile opens its tag's page.
 */
function Tiles({
  tiles,
  loading,
  beside,
}: {
  tiles: readonly HomeTile[]
  loading: boolean
  /** Whether the card column stands beside the tiles, taking its width from theirs. */
  beside: boolean
}): ReactNode {
  const openTag = useOpenTag()
  const art = useArt()
  const roomy = useLayoutValue(roomyPhone)
  // As many tiles of `WIDE_TILE_MIN` as fit, two to three (`C03` draws
  // three), more once three would outgrow `WIDE_TILE_MAX`; a page narrowed
  // by Up next drops a column rather than cutting the names (M1). The number
  // is only for how many columns and the name's size, which may follow a
  // frame behind.
  const { columns, tileWidth } = useTileGrid({
    minTile: WIDE_TILE_MIN,
    gap: TILE_GAP,
    maxColumns: 3,
    maxTile: WIDE_TILE_MAX,
    reserve: beside ? SIDE_COLUMN + COLUMN_GAP : 0,
    phoneColumns: roomy ? 3 : 2,
  })
  const small = tileWidth > 0 && tileWidth < SMALL_TILE
  if (loading) return <TilesWaiting columns={columns} />
  if (tiles.length === 0) {
    return (
      <EmptyState
        compact
        style={styles.emptyTile}
        testID="home-no-tags"
        title="No tags yet"
        line="Tag a song from its ⋯ menu."
      />
    )
  }
  return (
    <HomeTiles
      tiles={tiles}
      columns={columns}
      small={small}
      artFor={tile => (tile.cover ? art(tile.cover) : null)}
      onOpen={tile => openTag(tile.tag, { from: 'tile' })}
    />
  )
}

/** The tiles' shapes while the library is on its way: two rows of them, a tile high (AA1). */
function TilesWaiting({ columns }: { columns: number }): ReactNode {
  const { wide } = useLayout()
  const cells = useMemo(() => Array.from({ length: columns * 2 }, (_, index) => index), [columns])
  return (
    <Skeleton label="Loading your tags" testID="home-tiles-loading">
      <TileGrid
        items={cells}
        columns={columns}
        gap={TILE_GAP}
        keyOf={cell => cell}
        renderItem={() => <Bone height={wide ? 118 : 104} radius={radius.card} />}
      />
    </Skeleton>
  )
}

/** Recently played's shapes: a row of covers, each with its name under it. */
function RecentsWaiting({ wide }: { wide: boolean }): ReactNode {
  const size = wide ? RECENT_TILE : 92
  return (
    <Skeleton label="Loading recently played" style={styles.recentsWaiting}>
      {Array.from({ length: RECENTS_LEAST }, (_, index) => (
        <View key={index} style={[styles.recentWaiting, { width: size }]}>
          <Bone width={size} height={size} radius={radius.cover} />
          <Bone width="70%" height={11} radius={radius.pill} />
        </View>
      ))}
    </Skeleton>
  )
}

/**
 * The grid itself, mounted the first time there are tiles to draw. That
 * mount, once a session, is when they fade up 60 ms apart (`M1`, 4); a tab
 * switch or coming back to Home finds them already there, so the welcome
 * never turns into a wait.
 */
function HomeTiles({
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
  return (
    <TileGrid
      items={tiles}
      columns={columns}
      gap={TILE_GAP}
      keyOf={tile => tile.tag.id}
      renderItem={(tile, index) => (
        <Tile
          tile={tile}
          index={index}
          count={tiles.length}
          arrive={arrive}
          small={small}
          artUri={artFor(tile)}
          onPress={() => onOpen(tile)}
        />
      )}
    />
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
  const { wide } = useLayoutFlags()
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
    <Animated.View style={arrival}>
      <Press
        ref={ref}
        testID={`home-tile-${index}`}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${tile.tag.name}, ${plural(tile.songs, 'song', 'songs')}`}
        style={[styles.tile, wide && styles.tileWide, { backgroundColor: colours.tile }]}
      >
        {/* Two lines before it is cut: "night drive" whole rather than "night dri…". */}
        <Text
          style={[styles.tileName, small && styles.tileNameSmall, { color: colours.tileInk }]}
          numberOfLines={2}
        >
          {tile.tag.name}
        </Text>
        <Text style={[styles.tileCount, { color: colours.tileInk }]}>
          {plural(tile.songs, 'song', 'songs')}
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
      </Press>
    </Animated.View>
  )
}

/**
 * A song tile plays the row's songs from that one, and Up next is named
 * "Recently played" for them. It offers no Save and is not remembered as a
 * list of its own (`savePlan`, `sourceKey`): the row already is that list.
 */
const FROM_RECENTS = { kind: 'songs', origin: 'recent', name: 'Recently played' } as const

/**
 * Recently played (docs/features/lists.md, A1): what you listened to, newest
 * first, in a row that scrolls sideways — a list as its covers and its kind,
 * a song played on its own as that song. A tap plays it again; a list that
 * was never saved can be saved from Up next.
 */
function Recents({
  recents,
  rooms,
  wide,
}: {
  recents: readonly HomeRecent[]
  rooms: readonly PastRoom[]
  wide: boolean
}): ReactNode {
  const player = usePlayerCommands()
  const router = useRouter()
  const { data: library } = useLibrary()
  const size = wide ? RECENT_TILE : 92
  const songIds = useMemo(
    () => recents.flatMap(recent => (recent.kind === 'song' ? [recent.song.id] : [])),
    [recents],
  )
  const known = { tags: library?.tags ?? [], playlists: library?.playlists ?? [] }
  const fly = useFlyToUpNext()
  // Each list tile's covers, where a played list's covers fly from.
  const covers = useRef(new Map<string, View>())
  return (
    <Shelf testID="home-recents" contentStyle={styles.recents}>
      {rooms.map(room => (
        <PastRoomTile key={`room-${room.code}`} room={room} size={size} />
      ))}
      {recents.map((recent, index) => {
        if (recent.kind === 'song') {
          const song = recent.song
          return (
            <SongCard
              key={`song-${song.id}`}
              song={song}
              size={size}
              testID={`home-recent-${index}`}
              onPress={() =>
                player.playFrom(songIds, songIds.indexOf(song.id), { source: FROM_RECENTS })
              }
            />
          )
        }
        const { entry } = recent
        const line = describeSource(entry.source, known)
        return (
          <ShelfCard
            key={entry.key}
            width={size}
            testID={`home-recent-${index}`}
            onPress={() => {
              // A list opens, as any list's tile does; playing it is its page's Play.
              if (line.link) {
                router.push(line.link)
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
              player.playFrom(ids, 0, { source: entry.source, whole: true })
            }}
            label={line.link || entry.answer ? `Open ${line.label}` : `Play ${line.label}`}
            cover={
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
                    <Sparkle size={iconSize.tiny} />
                  </View>
                ) : null}
              </View>
            }
            title={line.label}
            lines={[recentKind(entry.source)]}
          />
        )
      })}
    </Shelf>
  )
}

/**
 * A room listened in together, once it ended (docs/features/listen-together.md,
 * mock R11): who was there, as their faces, big in the middle of the covers of
 * what played. Opens the room's page, to save it or get a friend's song.
 */
function PastRoomTile({ room, size }: { room: PastRoom; size: number }): ReactNode {
  const router = useRouter()
  const faces = pastRoomFaces(room)
  // The songs that played behind them, as a playlist's cover is made.
  const pictures = usePastRoomCovers(room)
  const covers = room.songs.map((entry, at) => ({
    uri: pictures[at],
    title: entry.song.album || entry.song.title,
  }))
  return (
    <ShelfCard
      width={size}
      testID={`home-recent-room-${room.code}`}
      onPress={() => router.push({ pathname: '/past-room/[code]', params: { code: room.code } })}
      label={`Open ${room.title}`}
      cover={<FacesCover people={faces} size={size} covers={covers} />}
      title={room.title}
      lines={[`Together · ${plural(room.songs.length, 'song', 'songs')}`]}
    />
  )
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
  // Worked out once for the head and the foot, which are both in the song's colour.
  const tone = useSundayTone(sunday ? sundaySong : null)
  const column = beside ? styles.sideColumn : styles.stack
  if (!stats) return <View style={column} />
  const figures = statFigures(stats)
  return (
    <View style={column}>
      <SectionHead title="This week" action={null} />
      <View style={styles.weekCard} testID="home-this-week">
        {sunday ? <WeekReadyHead card={sunday} song={sundaySong} tone={tone} /> : null}
        <StatFigures>
          <StatFigure value={figures.listened} unit={figures.listenedUnit} caption="listened" />
          <StatFigure value={figures.plays} caption={figures.playsCaption} />
          {/* "2 days", not "2 d": the unit is set small, so it fits (Xiao). */}
          <StatFigure value={figures.streak} unit={figures.streakUnit} caption="streak" />
        </StatFigures>
        {sunday ? (
          <OpenWeek card={sunday} tone={tone} onOpen={onOpenWeek} />
        ) : (
          <Press feedback="dim" onPress={() => router.navigate('/stats')} accessibilityRole="link">
            <Text style={styles.linkSmall}>Stats and report</Text>
          </Press>
        )}
      </View>
    </View>
  )
}

/** The colours of the week's number one: its cover's, or the accent without one. */
interface SundayTone {
  readonly uri: string | null | undefined
  readonly tint: string
  readonly color: string
}

function useSundayTone(song: Song | null): SundayTone {
  const art = useArt()
  const uri = song ? art(song) : null
  return { uri, ...useSongColor(song, uri) }
}

/**
 * This week's head on a Sunday: the number one, over a wash of its cover's
 * colour that goes under the whole card, so it is drawn first.
 */
function WeekReadyHead({
  card,
  song,
  tone,
}: {
  card: SundayCard
  song: Song | null
  tone: SundayTone
}): ReactNode {
  const lead = card.song
  return (
    <>
      <ToneWash color={tone.color} diagonal />
      <View style={styles.readyHead}>
        {song ? <SundaySong song={song} tone={tone} size={READY_COVER} /> : null}
        <View style={styles.sundayText}>
          {/* Plain case: the number one is what the card is about (A1). */}
          <Text style={styles.readyKicker}>{lead ? 'Song of the week' : card.title}</Text>
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

/** The week's number one's cover, standing on the card: the phone's card and This week's head. */
function SundaySong({
  song,
  tone,
  size,
}: {
  song: Song
  tone: SundayTone
  size: number
}): ReactNode {
  return (
    <View style={styles.sundayCover}>
      <Cover uri={tone.uri} title={song.album || song.title} size={size} />
    </View>
  )
}

/** And its foot: the button that opens the week, in the song's colour. */
function OpenWeek({
  card,
  tone,
  onOpen,
}: {
  card: SundayCard
  tone: SundayTone
  onOpen: () => void
}): ReactNode {
  return (
    <Press
      testID="home-sunday"
      onPress={onOpen}
      accessibilityRole="link"
      // The button's own words first, then what the card says: the phone's card says the same.
      accessibilityLabel={`Open the report. ${sundaySpoken(card)}`}
      style={[styles.readyButton, { backgroundColor: tone.tint }]}
    >
      <Text style={styles.readyButtonLabel}>Open the report</Text>
    </Press>
  )
}

/** The round mark that opens Profile, in the phone's header. */
const AVATAR = 36

/** The week's number one: on the phone's Sunday card, and at This week's head. */
const SUNDAY_COVER = 76
const READY_COVER = 52

/** Between two tiles, across and down. */
const TILE_GAP = 10
/** A computer's Recently played tile, the gap after it, and the fewest the row asks for. */
const RECENT_TILE = 132
const RECENT_GAP = 10
const RECENTS_LEAST = 12
/** A tile narrower than this (Slide Over's 320, `T08`) sets its name a size down. */
const SMALL_TILE = 140
/** The narrowest a computer's tile gets before the grid drops a column. */
const WIDE_TILE_MIN = 190
/**
 * The phone's layout at a tablet's width — an iPad held upright, 744 and up
 * (AI1) — has room for three tiles across; a phone, 440 at most, has two.
 */
const ROOMY_PHONE = 600
const roomyPhone = (layout: { wide: boolean; width: number }): boolean =>
  !layout.wide && layout.width >= ROOMY_PHONE
/** And the widest, past which a very wide page takes another column. */
const WIDE_TILE_MAX = 360

/** The card column beside the tiles. */
const SIDE_COLUMN = 300
const COLUMN_GAP = 30
/** Whether the card column sits beside the tiles, or under them. */
function useCardsBeside(wide: boolean): boolean {
  const column = useContentWidth()
  return wide && (column === null || column >= COLUMN_WIDTH.homeCardsBeside)
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { gap: 22 },
  contentNarrow: pageFrame(false),
  contentWide: pageFrame(true),
  stack: { gap: space.snug },
  columns: { flexDirection: 'row', gap: COLUMN_GAP, alignItems: 'flex-start' },
  mainColumn: { flex: 1, minWidth: 0, gap: space.md },
  sideColumn: { width: SIDE_COLUMN, gap: space.md },
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  greetingBlock: { gap: space.xs, paddingTop: space.roomy },
  // A phone's room is under its header; a computer's greeting starts where
  // every page's title does.
  greetingBlockWide: { paddingTop: 0 },
  greeting: nameTitle(theme.colors),
  greetingDot: { fontFamily: fonts.serifItalic, color: theme.colors.accent },
  subline: { color: theme.colors.textSecondary, fontSize: type.body },
  // The Sunday card (`P06`, E): the week's number one, under the greeting.
  sunday: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.roomy,
    padding: space.roomy,
    overflow: 'hidden',
  },
  sundayCover: { ...artShadow(theme.colors, 'lean'), borderRadius: radius.cover },
  sundayText: { flex: 1, minWidth: 0, gap: 3 },
  kicker: label(theme.colors),
  sundayTitle: { ...sectionTitle(theme.colors), fontSize: type.title },
  sundayLine: { color: theme.colors.textSecondary, fontSize: type.sub },
  linkSmall: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '600' },
  tile: {
    height: 104,
    borderRadius: radius.card,
    padding: space.roomy,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  tileWide: { height: 118, padding: space.lg },
  tileName: {
    fontFamily: fonts.display,
    ...textStyle('large'),
    letterSpacing: tracking.heading,
    paddingRight: 36,
  },
  tileNameSmall: { ...textStyle('section') },
  tileCount: { fontSize: type.small, fontWeight: '500' },
  tileCover: {
    position: 'absolute',
    right: -8,
    bottom: -10,
    transform: [{ rotate: '8deg' }],
    ...artShadow(theme.colors, 'lean'),
    borderRadius: radius.item,
  },
  tileCoverWide: { right: -6, bottom: -8 },
  recentsWaiting: { flexDirection: 'row', gap: RECENT_GAP, overflow: 'hidden' },
  recentWaiting: { gap: space.sm },
  emptyTile: card(theme.colors),
  firstCard: {
    borderRadius: radius.cardLg,
    padding: 22,
    gap: space.snug,
    alignItems: 'flex-start',
  },
  firstTitle: serif(theme.colors, 'page'),
  firstLine: { color: theme.colors.textSecondary, ...textStyle('sub') },
  weekLater: { color: theme.colors.textMuted, ...textStyle('sub') },
  firstAction: { marginTop: space.tight },
  recents: { paddingRight: 20 },
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
  weekCard: {
    ...card(theme.colors, radius.cardLg),
    padding: space.card,
    gap: space.roomy,
    overflow: 'hidden',
  },
  readyHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  readyKicker: { color: theme.colors.textSecondary, fontSize: type.sub },
  readyTitle: rowTitle(theme.colors),
  readyButton: {
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyButtonLabel: { color: theme.colors.surface0, fontSize: type.sub, fontWeight: '600' },
}))
