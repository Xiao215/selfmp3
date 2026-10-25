import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Image, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import Svg, { Path } from 'react-native-svg'
import type { Song, Stats, Tag } from '@selfmp3/shared'
import {
  motion,
  radius,
  type,
  useLibrary,
  type ServerConnection,
  space,
  withAlpha,
} from '@selfmp3/client'
import { useContentWidth, useContentWidthValue } from '../../shell/contentWidth'
import { useLayout } from '../../shell/useLayout'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { Cover } from '../../ui/components/Cover'
import { TagDot } from '../../ui/components/TagDot'
import { Segmented } from '../../ui/components/Segmented'
import { useFade } from '../../ui/motion'
import { card, label, serif, rowTitle } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { songLink } from '../song/song.model'
import { artistLink } from '../tag/placeLinks'
import { useOpenTag } from '../tag/useOpenTag'
import { useArtistPicture } from '../tag/useArtistPicture'
import { backdropVeil } from '../nowPlaying/nowPlaying.model'
import { useShownScheme } from '../../ui/theme/unistyles'
import { StatsFrame } from './StatsFrame'
import { useStatsFor, useStatsSongs } from './statsSource'
import {
  artistCoverSong,
  listenedCard,
  peakCard,
  RANK_KINDS,
  rankedEmpty,
  rankedRows,
  sparkPath,
  statsRangeFor,
  streakCard,
  type RankedRow,
  type RankKind,
  type StatsPeriod,
} from './stats.model'
import { EmptyState } from '../../ui/components/EmptyState'
import { PageLoading } from '../../ui/components/PageLoading'
import { Press } from '../../ui/components/Press'
import { COLUMN_WIDTH } from '../../shell/widths'
import { SHOWS_WHEN_REACHABLE } from '../library/library.model'

/** The line beside Listened, in its own box's units. */
const SPARK = { width: 120, height: 56 }

/**
 * Stats (`P32`, `C15`): Listened, Peak hour and Streak as cards, each one big
 * number with a small picture of where it came from, then one ranked module of
 * what was played most. The month told as a page is the Report's, one link away.
 *
 * `via` is a server reached directly from a cloud library (StatsViaServer): the
 * numbers are then its, and the songs they name are lined up with this
 * device's (statsSource.ts).
 */
export function StatsScreen({ via }: { via?: ServerConnection } = {}): ReactNode {
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const { data: stats, isLoading } = useStatsFor(via, statsRangeFor(period))

  return (
    <StatsFrame period={period} onPeriod={setPeriod} testID="stats-screen">
      {isLoading && !stats ? (
        <PageLoading line="Working it out…" />
      ) : !stats ? (
        <EmptyState title="Stats need your library" line={SHOWS_WHEN_REACHABLE} />
      ) : stats.totals.plays === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          line="Play some music and this fills in — how long, when, and what most."
        />
      ) : (
        <>
          <Cards stats={stats} />
          <Ranked stats={stats} via={via} />
        </>
      )}
    </StatsFrame>
  )
}

/**
 * The three cards. A page column with the room lays them in one row, Listened
 * twice as wide; a phone, or a computer's column the sidebar and Up next have
 * narrowed, gives Listened the width and puts the other two side by side under
 * it. Measured on the column, not the window: at 820, or with the rail open
 * at 1100, a row left Listened's number 64 px beside its line and cut it to "1 …".
 */
function Cards({ stats }: { stats: Stats }): ReactNode {
  const { wide } = useLayout()
  const row = useContentWidthValue(width => width !== null && width >= COLUMN_WIDTH.statsCards)
  // On a very wide page the line runs across the card from the words, rather
  // than sitting at the card's far end 1000 px from its number (P1 C).
  const fill = useContentWidthValue(width => width !== null && width >= COLUMN_WIDTH.wideFill)
  const listened = useMemo(() => listenedCard(stats), [stats])
  const peak = useMemo(() => peakCard(stats.hourly), [stats])
  // Today is read once per answer: the dots move on when the numbers do.
  const streak = useMemo(() => streakCard(stats, new Date()), [stats])

  const listenedView = (
    <View style={[styles.card, styles.listened, wide && styles.cardWide]} testID="stats-listened">
      <View style={[styles.listenedWords, fill && styles.listenedWordsHug]}>
        <Text style={styles.cardLabel}>Listened</Text>
        <Text style={styles.bigNumber} numberOfLines={1}>
          {listened.value}
        </Text>
        <Text style={styles.cardLine}>{listened.line}</Text>
      </View>
      <Spark values={listened.trend} fill={fill} />
    </View>
  )

  const peakView = (
    <View
      style={[styles.card, styles.small, wide && styles.cardWide]}
      accessible
      accessibilityLabel={
        peak.value ? `Peak hour: ${peak.value}, ${peak.words}` : 'Peak hour: no plays yet'
      }
      testID="stats-peak"
    >
      <Text style={styles.cardLabel}>Peak hour</Text>
      <View style={[styles.hours, wide && styles.hoursWide]}>
        {peak.bars.map((share, hour) => (
          <View
            key={hour}
            style={[
              styles.hour,
              { height: `${Math.max(4, share * 100)}%` },
              hour === peak.peak && styles.hourPeak,
            ]}
          />
        ))}
      </View>
      <View style={styles.cardFoot}>
        <Text style={styles.midNumber}>{peak.value ?? '—'}</Text>
        {peak.words ? <Text style={styles.cardNote}>{peak.words}</Text> : null}
      </View>
    </View>
  )

  const streakView = (
    <View
      style={[styles.card, styles.small, wide && styles.cardWide]}
      accessible
      accessibilityLabel={`Streak: ${streak.value}${streak.line ? `, ${streak.line}` : ''}`}
      testID="stats-streak"
    >
      <Text style={styles.cardLabel}>Streak</Text>
      <View style={styles.dots}>
        {streak.dots.map(dot => (
          <View
            key={dot.date}
            style={[
              styles.dot,
              dot.played && styles.dotPlayed,
              // Today is white whichever it is: where the run stands now.
              dot.today && styles.dotToday,
            ]}
          />
        ))}
      </View>
      <View style={styles.cardFoot}>
        <Text style={styles.midNumber}>{streak.value}</Text>
        {streak.line ? <Text style={styles.cardNote}>{streak.line}</Text> : null}
      </View>
    </View>
  )

  if (row) {
    return (
      <View style={styles.cardRow}>
        <View style={styles.twoCols}>{listenedView}</View>
        <View style={styles.oneCol}>{peakView}</View>
        <View style={styles.oneCol}>{streakView}</View>
      </View>
    )
  }
  return (
    <>
      {listenedView}
      <View style={styles.cardRow}>
        <View style={styles.oneCol}>{peakView}</View>
        <View style={styles.oneCol}>{streakView}</View>
      </View>
    </>
  )
}

/**
 * Minutes per day as one accent stroke. Decoration beside the number, so
 * unread. `fill` draws it across the room the words leave, as wide as that is.
 */
function Spark({ values, fill = false }: { values: readonly number[]; fill?: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const [room, setRoom] = useState(0)
  if (values.length < 2) return null
  const width = fill ? room : SPARK.width
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={fill ? styles.sparkFill : null}
      onLayout={fill ? event => setRoom(Math.floor(event.nativeEvent.layout.width)) : undefined}
    >
      {width > 0 ? (
        <Svg width={width} height={SPARK.height} viewBox={`0 0 ${width} ${SPARK.height}`}>
          <Path
            d={sparkPath(values, width, SPARK.height)}
            fill="none"
            stroke={theme.colors.accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </View>
  )
}

/**
 * What was played most: Songs, Artists and Tags. A phone shows one at a time
 * and switches between them; a computer with the width for all three puts them
 * side by side, as `C15` draws them. The page column is measured rather than
 * the window, since the sidebar and Up next's rail take their share of it.
 */
function Ranked({ stats, via }: { stats: Stats; via: ServerConnection | undefined }): ReactNode {
  const column = useContentWidth()
  const [kind, setKind] = useState<RankKind>('songs')

  if (column !== null && column >= COLUMN_WIDTH.statsLists) {
    return (
      <View style={[styles.card, styles.rankedWide]} testID="stats-ranked">
        {RANK_KINDS.map(option => (
          <View key={option.value} style={styles.rankedColumn}>
            <SectionHead look="label" title={option.label} style={styles.columnLabel} />
            <RankedList stats={stats} kind={option.value} via={via} />
          </View>
        ))}
      </View>
    )
  }
  return (
    <View style={[styles.card, styles.ranked]} testID="stats-ranked">
      <Segmented value={kind} onChange={setKind} label="Most played" options={RANK_KINDS} />
      <RankedList stats={stats} kind={kind} via={via} />
    </View>
  )
}

function RankedList({
  stats,
  kind,
  via,
}: {
  stats: Stats
  kind: RankKind
  via: ServerConnection | undefined
}): ReactNode {
  const rows = useMemo(() => rankedRows(stats, kind), [stats, kind])
  const songFor = useStatsSongs(via)
  const { data: library } = useLibrary()
  const tagOf = useMemo(() => new Map((library?.tags ?? []).map(tag => [tag.name, tag])), [library])
  // The cover each artist wears where the server has no picture of them.
  const coverOf = useMemo(() => {
    const covers = new Map<string, Song>()
    if (kind !== 'artists') return covers
    const played = stats.topSongs
      .map(top => songFor(top.songId))
      .filter((song): song is Song => song !== undefined)
    for (const row of rows) {
      const song = artistCoverSong(row.name, played, library?.songs ?? [])
      if (song) covers.set(row.key, song)
    }
    return covers
  }, [kind, rows, stats, songFor, library])

  if (rows.length === 0) return <Text style={styles.listEmpty}>{rankedEmpty(kind)}</Text>
  return (
    <View>
      {rows.map((row, index) =>
        row.kind === 'song' && index === 0 ? (
          <SongLead
            key={row.key}
            row={row}
            song={songFor(row.songId)}
            testID={`stats-ranked-${kind}-${index}`}
          />
        ) : row.kind === 'artist' && index === 0 ? (
          <ArtistLead
            key={row.key}
            row={row}
            cover={coverOf.get(row.key)}
            testID={`stats-ranked-${kind}-${index}`}
          />
        ) : (
          <RankedLine
            key={row.key}
            row={row}
            song={row.kind === 'song' ? songFor(row.songId) : undefined}
            cover={coverOf.get(row.key)}
            tag={row.kind === 'tag' ? tagOf.get(row.name) : undefined}
            testID={`stats-ranked-${kind}-${index}`}
          />
        ),
      )}
    </View>
  )
}

/**
 * The most-played artist, as a card rather than a line: their round picture
 * beside the rank, blurred across the card behind it (Xiao chose A,
 * 2026-10-24). Without a picture it is the cover they wear in the lines below.
 */
function ArtistLead({
  row,
  cover,
  testID,
}: {
  row: Extract<RankedRow, { kind: 'artist' }>
  cover: Song | undefined
  testID: string
}): ReactNode {
  const router = useRouter()
  const artFor = useArt()
  const backdropFor = useArt(ROW_COVER_SIZE)
  const picture = useArtistPicture(row.known ? row.name : null)
  // On its way while the picture is, so a cover does not flash up before the
  // picture that replaces it.
  const art =
    picture === undefined ? undefined : (picture?.portrait ?? (cover ? artFor(cover) : null))
  const backdrop =
    picture === undefined ? null : (picture?.portrait ?? (cover ? backdropFor(cover) : null))
  return (
    <LeadCard
      art={art}
      backdrop={backdrop}
      // A portrait has no tone of its own; the cover standing in for one does.
      tone={picture?.portrait ? null : (cover?.coverTone ?? null)}
      round
      rank={row.rank}
      name={row.name}
      note={`${row.trailing} · most played`}
      label={`${row.rank}. ${row.name}, ${row.trailing}`}
      open={row.known ? () => router.navigate(artistLink(row.name)) : undefined}
      testID={testID}
    />
  )
}

/**
 * The most-played song, in the same card as the artist beside it (Xiao,
 * 2026-10-01), lit by its own cover. A song this device cannot line up with
 * the server's has no cover to show and opens nothing, as its line would.
 */
function SongLead({
  row,
  song,
  testID,
}: {
  row: Extract<RankedRow, { kind: 'song' }>
  song: Song | undefined
  testID: string
}): ReactNode {
  const router = useRouter()
  const artFor = useArt()
  const backdropFor = useArt(ROW_COVER_SIZE)
  return (
    <LeadCard
      art={song ? artFor(song) : null}
      backdrop={song ? backdropFor(song) : null}
      tone={song?.coverTone ?? null}
      round={false}
      rank={row.rank}
      name={row.name}
      note={row.artist ? `${row.trailing} · ${row.artist}` : row.trailing}
      label={`${row.rank}. ${row.name}${row.artist ? `, ${row.artist}` : ''}, ${row.trailing}`}
      open={song ? () => router.navigate(songLink(song.id)) : undefined}
      testID={testID}
    />
  )
}

/** The picture beside first place's rank: the card's height less room above and below. */
const LEAD_PICTURE = 84

/**
 * First place as a card: the serif rank, the picture sharp beside it and the
 * name, over that picture blurred to fill the card and veiled in the card's
 * tone so the words read on any cover. Without a picture it is the card's
 * raised tone and the picture's letter tile. The bar is left out: the first
 * one is always full.
 */
function LeadCard({
  art,
  backdrop,
  tone,
  round,
  rank,
  name,
  note,
  label: spoken,
  open,
  testID,
}: {
  art: string | null | undefined
  /** The same picture, small: blurred, a 128 looks the same and costs far less on iOS. */
  backdrop: string | null | undefined
  tone: Song['coverTone']
  round: boolean
  rank: number
  name: string
  note: string
  label: string
  open: (() => void) | undefined
  testID: string
}): ReactNode {
  const { theme } = useUnistyles()
  const scheme = useShownScheme()
  const [loaded, setLoaded] = useState<string | null>(null)
  const shown = useFade(!!backdrop && loaded === backdrop, motion.base, motion.base)
  // Without a tone to judge by (an artist's own picture), the veil a light
  // picture would need, so a white portrait still leaves the name readable.
  const veil = backdropVeil(tone, scheme, tone ? 0.5 : 0.72)

  return (
    <Press
      depth="row"
      disabled={!open}
      onPress={open}
      accessibilityRole={open ? 'link' : undefined}
      accessibilityLabel={spoken}
      testID={testID}
      style={styles.lead}
    >
      {backdrop ? (
        <Animated.View pointerEvents="none" style={[styles.leadLight, { opacity: shown }]}>
          <Image
            source={{ uri: backdrop }}
            style={styles.leadBlur}
            resizeMode="cover"
            blurRadius={40}
            onLoad={() => setLoaded(backdrop)}
            accessibilityIgnoresInvertColors
          />
          <View
            style={[styles.leadLight, { backgroundColor: withAlpha(theme.colors.surface3, veil) }]}
          />
        </Animated.View>
      ) : null}
      <View style={styles.leadWords}>
        <Text style={styles.leadRank}>{rank}</Text>
        <Cover
          uri={art}
          title={name}
          size={LEAD_PICTURE}
          radius={round ? LEAD_PICTURE / 2 : undefined}
        />
        <View style={styles.leadNames}>
          <Text style={styles.leadName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.leadNote} numberOfLines={1}>
            {note}
          </Text>
        </View>
      </View>
    </Press>
  )
}

/**
 * An artist beside their name: their picture cut round, as YouTube Music
 * shows them, or the cover of theirs they are played for, round so it still
 * reads as a person beside the square covers of songs.
 */
function RankedArtistFace({
  name,
  known,
  cover,
}: {
  name: string
  known: boolean
  cover: Song | undefined
}): ReactNode {
  const artFor = useArt()
  const picture = useArtistPicture(known ? name : null)
  const uri = picture === undefined ? null : (picture?.portrait ?? (cover ? artFor(cover) : null))
  return <Cover uri={uri} title={name} size={36} radius={18} />
}

/**
 * One place in the ranking: its number in the serif, a picture, the name and
 * how much, and a bar under the name. The first bar is the accent; the rest
 * are quieter, so the eye reads the list as "the first, and then the others".
 *
 * Each opens its page: a song its own page, an artist or a tag the place. A
 * song this device cannot line up with the server's, the songs with no
 * artist, and a tag the library no longer has (it has no colour either) open
 * nothing.
 */
function RankedLine({
  row,
  song,
  cover,
  tag,
  testID,
}: {
  row: RankedRow
  song: Song | undefined
  /** An artist's stand-in cover (`RankedArtistFace`). */
  cover: Song | undefined
  /** A tag's own; none when the library no longer has it. */
  tag: Tag | undefined
  testID: string
}): ReactNode {
  const router = useRouter()
  const openTag = useOpenTag()
  const artFor = useArt()

  const open =
    row.kind === 'song'
      ? song
        ? () => router.navigate(songLink(song.id))
        : undefined
      : row.kind === 'artist'
        ? row.known
          ? () => router.navigate(artistLink(row.name))
          : undefined
        : tag
          ? () => openTag(tag)
          : undefined

  const picture =
    row.kind === 'song' ? (
      <Cover uri={song ? artFor(song) : null} title={row.name} size={36} />
    ) : row.kind === 'artist' ? (
      <RankedArtistFace name={row.name} known={row.known} cover={cover} />
    ) : (
      <View style={styles.tagSquare}>
        <TagDot hue={tag?.hue} size={10} />
      </View>
    )

  return (
    <Press
      feedback="dim"
      disabled={!open}
      onPress={open}
      accessibilityRole={open ? 'link' : undefined}
      accessibilityLabel={`${row.rank}. ${row.name}${
        row.kind === 'song' && row.artist ? `, ${row.artist}` : ''
      }, ${row.trailing}`}
      testID={testID}
      style={styles.line}
    >
      <Text style={styles.rank}>{row.rank}</Text>
      {picture}
      <View style={styles.lineBody}>
        <View style={styles.lineTop}>
          <Text style={styles.lineName} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={styles.lineTrailing} numberOfLines={1}>
            {row.trailing}
          </Text>
        </View>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              row.rank === 1 && styles.fillFirst,
              { width: `${Math.max(2, row.share * 100)}%` },
            ]}
          />
        </View>
      </View>
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  // A big card on the ground (`S2`: 22 round), told apart by tone, not an edge.
  card: { ...card(theme.colors, radius.cardLg), padding: space.card },
  cardWide: { height: 190, paddingHorizontal: 20 },
  cardRow: { flexDirection: 'row', gap: space.md },
  twoCols: { flex: 2, minWidth: 0 },
  oneCol: { flex: 1, minWidth: 0 },
  listened: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
  },
  // The words take the card's room before the spark does: squeezed, the number
  // was ellipsised to "2…", which is not a number.
  listenedWords: { gap: space.xs, flex: 1, minWidth: 0 },
  listenedWordsHug: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  sparkFill: { flex: 1, height: SPARK.height, marginLeft: space.gutterWide },
  cardLabel: label(theme.colors),
  // Big numbers are the serif, which has one weight (`S2`), on the scale's
  // line height, which has room for its tall figures.
  bigNumber: serif(theme.colors),
  cardLine: { color: theme.colors.textSecondary, fontSize: type.sub },
  small: { height: 150, padding: space.lg, justifyContent: 'space-between' },
  hours: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 44 },
  hoursWide: { height: 60 },
  // An hour with plays is the raised tone; the busiest is the accent.
  hour: { flex: 1, borderRadius: 2, backgroundColor: theme.colors.surface3 },
  hourPeak: { backgroundColor: theme.colors.accent },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.surface3 },
  dotPlayed: { backgroundColor: theme.colors.accent },
  dotToday: { backgroundColor: theme.colors.textPrimary },
  cardFoot: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.sm },
  midNumber: serif(theme.colors, 'page'),
  cardNote: { color: theme.colors.textSecondary, fontSize: type.small },
  ranked: {
    paddingTop: space.roomy,
    paddingBottom: space.sm,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  rankedWide: { flexDirection: 'row', gap: 36, paddingVertical: 18, paddingHorizontal: 22 },
  rankedColumn: { flex: 1, minWidth: 0, gap: space.xs },
  columnLabel: { paddingBottom: space.xs },
  listEmpty: { color: theme.colors.textMuted, fontSize: type.sub, paddingVertical: space.roomy },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    minHeight: 48,
    borderRadius: radius.cover,
  },
  rank: { ...serif(theme.colors, 'section'), width: 18, color: theme.colors.textMuted },
  lead: {
    height: 112,
    marginBottom: space.tight,
    borderRadius: radius.card,
    overflow: 'hidden',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  leadLight: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  // Drawn past the card's edges, where a blur thins out toward nothing.
  leadBlur: { position: 'absolute', top: -40, bottom: -40, left: -40, right: -40 },
  leadWords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.roomy,
    paddingRight: space.lg,
  },
  leadRank: serif(theme.colors),
  leadNames: { flex: 1, minWidth: 0 },
  leadName: { color: theme.colors.textPrimary, fontSize: type.section, fontWeight: '700' },
  leadNote: { color: theme.colors.textSecondary, fontSize: type.small, marginTop: 2 },
  tagSquare: {
    width: 36,
    height: 36,
    borderRadius: radius.cover,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  lineBody: { flex: 1, minWidth: 0, gap: 5 },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  // The name takes what is left and ellipsises; the figure beside it never
  // gives up room, or a long title squeezes "3 plays" down to "3" and then
  // past the column's edge (Xiao, 2026-09-21).
  lineName: {
    flexShrink: 1,
    minWidth: 0,
    ...rowTitle(theme.colors),
  },
  lineTrailing: { flexShrink: 0, color: theme.colors.textSecondary, fontSize: type.small },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: theme.colors.textMuted },
  fillFirst: { backgroundColor: theme.colors.accent },
}))
