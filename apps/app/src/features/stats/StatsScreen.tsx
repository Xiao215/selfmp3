import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import {
  formatLongDuration,
  formatRelative,
  STATS_RANGE_LABELS,
  type StatsRange,
} from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { useHistory, useLibrary, useStats } from '../../api/queries'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { BarList, ColumnChart, StatTile } from '../../ui/components/charts'
import { Sparkles } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SongLine } from './SongLine'
import { Segmented } from '../../ui/components/Segmented'
import {
  bestStreakHint,
  dailyColumns,
  daysLabel,
  formatHour,
  hourlyColumns,
  peakHour,
  playsLabel,
  rangeButtonLabel,
  recentSongs,
  STATS_RANGES,
} from './stats.model'

const GAP = 14
/** The web's panels: at least this wide, as many to a row as fit. */
const PANEL_MIN = 320

/**
 * Listening stats: the web's `StatsView`.
 *
 * Tiles first, because most of these answers are a single number; then the
 * charts, the top artists and tags, the most played, and what was played last.
 */
export function StatsScreen(): ReactNode {
  const router = useRouter()
  const accent = useAccent()
  const { wide } = useLayout()
  const [range, setRange] = useState<StatsRange>('30d')
  const { data: stats, isLoading } = useStats(range)
  const { data: history } = useHistory()
  const { data: library } = useLibrary()
  const [gridWidth, setGridWidth] = useState(0)

  const songById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const daily = useMemo(() => dailyColumns(stats?.daily ?? []), [stats])
  const hourly = useMemo(() => hourlyColumns(stats?.hourly ?? []), [stats])
  const recent = useMemo(() => recentSongs(history?.events ?? []), [history])
  const peak = stats ? peakHour(stats.hourly) : null

  const columns = wide ? Math.max(1, Math.floor((gridWidth + GAP) / (PANEL_MIN + GAP))) : 1
  const half = gridWidth > 0 && columns > 1 ? (gridWidth - GAP) / 2 : undefined

  const header = (
    <View style={[styles.head, !wide && styles.headNarrow]}>
      <View>
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Stats
        </Text>
        <Text style={styles.sub}>{STATS_RANGE_LABELS[range]}</Text>
      </View>
      <View style={[styles.actions, !wide && styles.actionsNarrow]}>
        <Segmented
          value={range}
          onChange={setRange}
          label="Time range"
          options={STATS_RANGES.map(option => ({ value: option, label: rangeButtonLabel(option) }))}
        />
        <Button
          label="Wrapped"
          variant="primary"
          icon={<Sparkles size={15} color={accent.onAccent} />}
          onPress={() => router.push('/stats/wrapped')}
        />
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID="stats-screen"
      >
        {header}

        {isLoading && !stats ? (
          <Text style={styles.hint}>Working it out…</Text>
        ) : !stats ? (
          <Empty
            title="Stats need your library"
            hint="They’ll be here when your Mac is reachable again."
          />
        ) : stats.totals.plays === 0 ? (
          <Empty
            emoji="📊"
            title="Nothing to show yet"
            hint="Play some music and this fills in — what you played, when, and how often."
          />
        ) : (
          <>
            <View style={styles.tiles}>
              {[
                <StatTile key="plays" label="Plays" value={stats.totals.plays.toLocaleString()} />,
                <StatTile
                  key="time"
                  label="Time listening"
                  value={formatLongDuration(stats.totals.minutes * 60)}
                />,
                <StatTile
                  key="songs"
                  label="Different songs"
                  value={stats.totals.songsPlayed.toLocaleString()}
                  hint={`of ${stats.totals.librarySize.toLocaleString()} in your library`}
                />,
                <StatTile
                  key="streak"
                  label="Current streak"
                  value={daysLabel(stats.streakDays)}
                  hint={bestStreakHint(stats.longestStreakDays)}
                />,
                <StatTile
                  key="never"
                  label="Never played"
                  value={stats.totals.neverPlayed.toLocaleString()}
                  hint="worth a shuffle sometime"
                />,
              ].map(tile => (
                <View key={tile.key} style={styles.tileCell}>
                  {tile}
                </View>
              ))}
            </View>

            <View
              style={styles.panels}
              onLayout={event => setGridWidth(event.nativeEvent.layout.width)}
            >
              <Panel title="Plays per day" hint={STATS_RANGE_LABELS[range]}>
                <ColumnChart
                  data={daily}
                  height={170}
                  emptyMessage="No plays in this window"
                  caption={`Plays per day, ${STATS_RANGE_LABELS[range].toLowerCase()}`}
                />
              </Panel>

              <Panel
                title="When you listen"
                hint={peak ? `busiest around ${formatHour(peak.hour)}` : undefined}
                width={half}
              >
                <ColumnChart
                  data={hourly}
                  height={140}
                  labelEvery={6}
                  caption="Plays by hour of the day"
                />
              </Panel>

              <Panel title="Top artists" width={half}>
                <BarList
                  data={stats.topArtists.map(entry => ({ label: entry.key, value: entry.plays }))}
                  emptyMessage="No artists yet"
                />
              </Panel>

              {stats.topTags.length > 0 ? (
                <Panel title="Top tags" width={half}>
                  <BarList
                    data={stats.topTags.map(entry => ({ label: entry.key, value: entry.plays }))}
                  />
                </Panel>
              ) : null}

              <Panel title="Most played" hint={STATS_RANGE_LABELS[range]}>
                <View style={styles.list}>
                  {stats.topSongs.slice(0, 10).map((entry, index) => (
                    <SongLine
                      key={entry.songId}
                      song={songById.get(entry.songId)}
                      title={entry.title}
                      artist={entry.artist}
                      rank={index + 1}
                      trailing={playsLabel(entry.plays)}
                    />
                  ))}
                </View>
              </Panel>

              {recent.length > 0 ? (
                <Panel title="Recently played">
                  <View style={[styles.list, wide && styles.listColumns]}>
                    {recent.slice(0, 24).map(event => (
                      <View key={event.songId} style={wide ? styles.columnCell : undefined}>
                        <SongLine
                          song={songById.get(event.songId)}
                          title={event.title}
                          artist={event.artist}
                          trailing={formatRelative(event.playedAt)}
                        />
                      </View>
                    ))}
                  </View>
                </Panel>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Panel({
  title,
  hint,
  width,
  children,
}: {
  title: string
  hint?: string
  /** Half the grid at desktop width; the full width otherwise. */
  width?: number
  children: ReactNode
}): ReactNode {
  return (
    <View style={[styles.panel, width !== undefined ? { width } : styles.panelFull]}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle} accessibilityRole="header">
          {title}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  )
}

function Empty({ emoji, title, hint }: { emoji?: string; title: string; hint: string }): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={styles.empty}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={[styles.panelTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.hint, styles.emptyHint]}>{hint}</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
  },
  headNarrow: { flexDirection: 'column', gap: 12 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsNarrow: { flexDirection: 'column', alignItems: 'flex-start' },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 },
  tileCell: { flexGrow: 1, flexBasis: 170 },
  panels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: GAP },
  panel: {
    padding: 18,
    gap: 12,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  panelFull: { width: '100%' },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 10,
  },
  panelTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  list: { gap: 1 },
  listColumns: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  columnCell: { flexBasis: 280, flexGrow: 1, maxWidth: '33.3%' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emoji: { fontSize: 36 },
  emptyHint: { textAlign: 'center', maxWidth: 360 },
}))
