import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { space, type, withAlpha } from '@selfmp3/client'
import { useVia } from '../../connection/via'
import { card, label, serif } from '../../ui/surfaces'
import { useSongHistoryFor } from '../stats/statsSource'
import { songStory, togetherCards, togetherHead, type WeekStrip } from './song.model'

/**
 * You and the song that is playing, as Now Playing's Details tab tells it
 * (H, 2026-10-27): "Yours since 3 August." and how much you have played it,
 * its weeks as bars with their plays over them, and the song page's story —
 * where it came from, the first play, the best week, the last — as small
 * cards (`togetherCards`). What it is made of was the tab's whole page before; now it is
 * the quiet line under this (`SongAbout`).
 */
export function SongTogether({ song }: { song: Song }): ReactNode {
  const via = useVia()
  const { data: history } = useSongHistoryFor(via, song.id)
  const known = history ?? null
  const { head, strip, cards } = useMemo(() => {
    const now = new Date()
    return {
      head: togetherHead(song, known, now),
      strip: songStory(song, known, now).strip,
      cards: togetherCards(song, known, now),
    }
  }, [known, song])

  return (
    <View style={styles.together} testID="now-playing-together">
      <View style={styles.head}>
        <Text style={styles.title}>{head.title}</Text>
        {head.line ? <Text style={styles.line}>{head.line}</Text> : null}
      </View>
      {strip ? <WeekBars strip={strip} /> : null}
      <View style={styles.cards}>
        {cards.map(row => (
          <View key={row.key} style={styles.card} testID={`now-playing-together-${row.key}`}>
            <Text style={styles.cardLabel}>{row.label}</Text>
            <Text style={styles.cardValue} numberOfLines={1}>
              {row.value}
            </Text>
            {row.sub ? (
              <Text style={styles.cardSub} numberOfLines={1}>
                {row.sub}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

/** Plays a week, oldest on the left, each bar's plays over it while there is room to read them. */
function WeekBars({ strip }: { strip: WeekStrip }): ReactNode {
  const counted = strip.bars.length <= COUNTED_BARS
  return (
    <View style={styles.weeks}>
      <View style={styles.bars} accessibilityLabel="Plays each week" testID="now-playing-weeks">
        {strip.bars.map((bar, index) => (
          // The bars are positions in time, and never move.
          <View key={index} style={styles.barColumn}>
            {counted && (strip.counts[index] ?? 0) > 0 ? (
              <Text style={styles.count}>{strip.counts[index]}</Text>
            ) : null}
            <View
              style={[
                styles.bar,
                { height: `${Math.round(bar * 100)}%` },
                index === strip.peak && styles.barPeak,
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.captions}>
        <Text style={styles.caption}>{strip.caption}</Text>
        <Text style={styles.caption}>This week</Text>
      </View>
    </View>
  )
}

/** Over this many bars a count over each is a row of crowded figures. */
const COUNTED_BARS = 16
/**
 * A card's least width: four fit across the column beside a computer's cover
 * (684 at 1440), and a narrower window's (488 at 1024) takes two and two
 * rather than three with one left under them.
 */
const CARD_BASIS = 160
/** The tallest bar's height; its count sits above it. */
const BARS_HEIGHT = 96

const styles = StyleSheet.create(theme => ({
  together: { gap: 28 },
  head: { gap: space.tight },
  title: serif(theme.colors, 'page'),
  line: { color: theme.colors.textSecondary, fontSize: type.body },
  weeks: { gap: space.sm },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.tight,
    // Room over the tallest bar for its count.
    height: BARS_HEIGHT + 18,
    paddingTop: 18,
  },
  barColumn: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  bar: {
    alignSelf: 'stretch',
    minHeight: 3,
    borderRadius: 4,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.12),
  },
  barPeak: { backgroundColor: theme.colors.accent },
  count: { color: theme.colors.textMuted, fontSize: type.small, fontVariant: ['tabular-nums'] },
  captions: { flexDirection: 'row', justifyContent: 'space-between' },
  caption: { color: theme.colors.textMuted, fontSize: type.small },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: space.snug },
  card: {
    ...card(theme.colors),
    flexGrow: 1,
    flexBasis: CARD_BASIS,
    minWidth: 0,
    gap: 2,
    paddingVertical: space.md,
    paddingHorizontal: space.roomy,
  },
  cardLabel: label(theme.colors),
  cardValue: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  cardSub: { color: theme.colors.textSecondary, fontSize: type.sub },
}))
