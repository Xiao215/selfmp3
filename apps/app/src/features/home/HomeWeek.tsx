import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useRouter } from 'expo-router'
import type { Song, Stats } from '@selfmp3/shared'
import { iconSize, radius, space, type } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { Cover } from '../../ui/components/Cover'
import { ChevronRight } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { SectionHead } from '../../ui/components/SectionHead'
import { StatFigure, StatFigures } from '../../ui/components/StatFigure'
import { useSongColor } from '../../ui/useSongColor'
import { useSvgId } from '../../ui/useSvgId'
import { artShadow, card, label, rowTitle, sectionTitle } from '../../ui/surfaces'
import { statFigures } from '../stats/stats.model'
import { sundaySpoken, type SundayCard } from './home.model'

/*
 * Home's week (docs/features/wrapped-and-gems.md): the Sunday card under a
 * phone's greeting, and This week beside a computer's tiles, both led on a
 * Sunday by the week's number one in its cover's colour (`ToneWash`).
 */

/** The week's number one: on the phone's Sunday card, and at This week's head. */
const SUNDAY_COVER = 76
const READY_COVER = 52

/**
 * The Sunday card on a phone (`P06`, E): led by the week's number one, its
 * cover large and the card washed in that cover's colour, so every Sunday
 * looks like its own week. A tap opens the week as a page. Without a song to
 * lead it, it says the week in the accent.
 */
export function SundayLead({
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
export function ToneWash({
  color,
  diagonal = false,
}: {
  color: string
  diagonal?: boolean
}): ReactNode {
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
 * A computer's card beside the tiles, or under them on a narrow page: this
 * week in three numbers, and the way to Stats. On a Sunday it is also the way
 * into the week as a page (`F`, Xiao 2026-10-04): the week's number one at its
 * head, the card washed in its cover's colour, and a button that opens the
 * week. Home's top keeps to the greeting and the search, rather than a bar
 * over these same numbers.
 */
export function ThisWeek({
  stats,
  style,
  sunday,
  sundaySong,
  onOpenWeek,
}: {
  stats: Stats | undefined
  /** The column it stands in: beside the tiles, or under them. */
  style: StyleProp<ViewStyle>
  sunday: SundayCard | null
  sundaySong: Song | null
  onOpenWeek: () => void
}): ReactNode {
  const router = useRouter()
  // Worked out once for the head and the foot, which are both in the song's colour.
  const tone = useSundayTone(sunday ? sundaySong : null)
  if (!stats) return <View style={style} />
  const figures = statFigures(stats)
  return (
    <View style={style}>
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

const styles = StyleSheet.create(theme => ({
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
