import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatLongDuration, formatRelative, STATS_RANGE_LABELS } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { ColumnChart, StatTile } from '../../ui/components/charts'
import { card, sectionTitle } from '../../ui/surfaces'
import { ReportTab } from '../wrapped/ReportTab'
import { SongLine } from './SongLine'
import { StatsFrame, type StatsFrameProps } from './StatsFrame'
import { useHistoryFor, useStatsFor, useStatsSongs } from './statsSource'
import {
  bestStreakHint,
  dailyColumns,
  daysLabel,
  formatHour,
  hourlyColumns,
  peakHour,
  recentSongs,
  statsRangeFor,
  type StatsPeriod,
  type StatsTab,
} from './stats.model'

/**
 * Stats: one page with two tabs, Overview and Report, over one shared window.
 *
 * `/stats` opens Overview and `/stats/report` opens Report; after that the
 * tabs switch in place, and the window chosen on one is the window the other
 * shows.
 *
 * `via` is a server reached directly from a cloud library (StatsViaServer): the
 * numbers are then its, and the songs they name are lined up with this
 * device's (statsSource.ts).
 */
export function StatsScreen({
  initialTab = 'overview',
  via,
}: { initialTab?: StatsTab; via?: ServerConnection } = {}): ReactNode {
  const [tab, setTab] = useState<StatsTab>(initialTab)
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const frame: StatsFrameProps = { tab, onTab: setTab, period, onPeriod: setPeriod }
  return tab === 'overview' ? <Overview {...frame} via={via} /> : <ReportTab {...frame} via={via} />
}

/**
 * The numbers.
 *
 * Tiles first, because most of these answers are a single number; then when
 * the plays happened, and what was played last. What was played most is the
 * Report's to tell, so it is not said twice.
 */
function Overview({ via, ...frame }: StatsFrameProps & { via?: ServerConnection }): ReactNode {
  const { wide } = useLayout()
  const range = statsRangeFor(frame.period)
  const { data: stats, isLoading } = useStatsFor(via, range)
  const { data: history } = useHistoryFor(via)
  const songFor = useStatsSongs(via)

  const daily = useMemo(() => dailyColumns(stats?.daily ?? []), [stats])
  const hourly = useMemo(() => hourlyColumns(stats?.hourly ?? []), [stats])
  const recent = useMemo(() => recentSongs(history?.events ?? []), [history])
  const peak = stats ? peakHour(stats.hourly) : null

  return (
    <StatsFrame {...frame} testID="stats-screen">
      {isLoading && !stats ? (
        <Text style={styles.hint}>Working it out…</Text>
      ) : !stats ? (
        <Empty
          title="Stats need your library"
          hint="They’ll be here when your server is reachable again."
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

          <View style={styles.panels}>
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
            >
              <ColumnChart
                data={hourly}
                height={140}
                labelEvery={6}
                caption="Plays by hour of the day"
              />
            </Panel>

            {recent.length > 0 ? (
              <Panel title="Recently played">
                <View style={[styles.list, wide && styles.listColumns]}>
                  {recent.slice(0, 24).map(event => (
                    <View key={event.songId} style={wide ? styles.columnCell : undefined}>
                      <SongLine
                        song={songFor(event.songId)}
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
    </StatsFrame>
  )
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}): ReactNode {
  return (
    <View style={styles.panel}>
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
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 },
  tileCell: { flexGrow: 1, flexBasis: 170 },
  panels: { gap: 14 },
  // A card on the ground: told apart by tone, not an edge (`S2`).
  panel: {
    ...card(theme.colors),
    padding: 18,
    gap: 12,
  },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 10,
  },
  panelTitle: sectionTitle(theme.colors),
  list: { gap: 1 },
  listColumns: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  columnCell: { flexBasis: 280, flexGrow: 1, maxWidth: '33.3%' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emoji: { fontSize: 36 },
  emptyHint: { textAlign: 'center', maxWidth: 360 },
}))
