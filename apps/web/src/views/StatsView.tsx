import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  formatLongDuration,
  formatRelative,
  STATS_RANGE_LABELS,
  type StatsRange,
} from '@selfmp3/shared'
import { useHistory, useLibrary, useStats } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { BarList, ColumnChart, StatTile, type ColumnDatum } from '../components/charts.js'
import { Cover } from '../components/Cover.js'
import { Sparkles } from '../components/Icons.js'

/**
 * Listening stats.
 *
 * Everything is derived from the stored play events, so the questions can
 * change later without the underlying data having been thrown away. The page
 * leads with stat tiles rather than charts, because most of these answers are
 * a single number and a plot would only get in the way.
 */

const RANGES: readonly StatsRange[] = ['7d', '30d', '90d', '365d', 'all']

export function StatsView() {
  const [range, setRange] = useState<StatsRange>('30d')
  const { data: stats, isLoading } = useStats(range)
  const { data: history } = useHistory()
  const { data: library } = useLibrary()
  const player = usePlayer()

  const songById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )

  const dailyData: ColumnDatum[] = useMemo(
    () =>
      (stats?.daily ?? []).map(day => ({
        label: shortDate(day.date),
        value: day.plays,
        detail: longDate(day.date),
      })),
    [stats],
  )

  const hourlyData: ColumnDatum[] = useMemo(
    () =>
      (stats?.hourly ?? []).map(hour => ({
        label: hour.hour % 6 === 0 ? formatHour(hour.hour) : '',
        value: hour.plays,
        detail: `${formatHour(hour.hour)}–${formatHour((hour.hour + 1) % 24)}`,
      })),
    [stats],
  )

  // The history is every play; the list is every song once, at its latest
  // play. Otherwise one song on repeat fills it.
  const recentSongs = useMemo(() => {
    const seen = new Set<number>()
    return (history?.events ?? []).filter(event => {
      if (seen.has(event.songId)) return false
      seen.add(event.songId)
      return true
    })
  }, [history])

  const peakHour = useMemo(() => {
    if (!stats || stats.hourly.length === 0) return null
    const best = stats.hourly.reduce((a, b) => (b.plays > a.plays ? b : a))
    return best.plays > 0 ? best : null
  }, [stats])

  if (isLoading && !stats) {
    return (
      <section className="view">
        <header className="view-head">
          <div className="view-titles">
            <h1>Stats</h1>
          </div>
        </header>
        <p className="hint">Working it out…</p>
      </section>
    )
  }

  if (!stats) {
    return (
      <section className="view">
        <div className="empty-state">
          <h2>Stats need your library</h2>
          <p className="hint">They’ll be here when your Mac is reachable again.</p>
        </div>
      </section>
    )
  }

  const noPlays = stats.totals.plays === 0

  return (
    <section className="view stats-view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Stats</h1>
          <p className="view-sub">{STATS_RANGE_LABELS[range]}</p>
        </div>

        <div className="view-actions">
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map(option => (
              <button
                key={option}
                type="button"
                className={`segmented-item ${range === option ? 'is-active' : ''}`}
                onClick={() => setRange(option)}
                aria-pressed={range === option}
              >
                {option === 'all' ? 'All' : option.replace('d', 'd')}
              </button>
            ))}
          </div>

          <Link to="/stats/wrapped" className="button button-primary">
            <Sparkles size={15} /> Wrapped
          </Link>
        </div>
      </header>

      {noPlays ? (
        <div className="empty-state">
          <p className="empty-emoji">📊</p>
          <h2>Nothing to show yet</h2>
          <p className="hint">
            Play some music and this fills in — what you played, when, and how often.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatTile label="Plays" value={stats.totals.plays.toLocaleString()} />
            <StatTile
              label="Time listening"
              value={formatLongDuration(stats.totals.minutes * 60)}
            />
            <StatTile
              label="Different songs"
              value={stats.totals.songsPlayed.toLocaleString()}
              hint={`of ${stats.totals.librarySize.toLocaleString()} in your library`}
            />
            <StatTile
              label="Current streak"
              value={`${stats.streakDays} ${stats.streakDays === 1 ? 'day' : 'days'}`}
              hint={
                stats.longestStreakDays > 0 ? `best: ${stats.longestStreakDays} days` : undefined
              }
            />
            <StatTile
              label="Never played"
              value={stats.totals.neverPlayed.toLocaleString()}
              hint="worth a shuffle sometime"
            />
          </div>

          <div className="stats-panels">
            <section className="panel panel-wide">
              <header className="panel-head">
                <h2>Plays per day</h2>
                <span className="hint">{STATS_RANGE_LABELS[range]}</span>
              </header>
              <ColumnChart
                data={dailyData}
                height={170}
                emptyMessage="No plays in this window"
                caption={`Plays per day, ${STATS_RANGE_LABELS[range].toLowerCase()}`}
              />
            </section>

            <section className="panel">
              <header className="panel-head">
                <h2>When you listen</h2>
                {peakHour && (
                  <span className="hint">busiest around {formatHour(peakHour.hour)}</span>
                )}
              </header>
              <ColumnChart
                data={hourlyData}
                height={140}
                labelEvery={6}
                caption="Plays by hour of the day"
              />
            </section>

            <section className="panel">
              <header className="panel-head">
                <h2>Top artists</h2>
              </header>
              <BarList
                data={stats.topArtists.map(entry => ({
                  label: entry.key,
                  value: entry.plays,
                }))}
                emptyMessage="No artists yet"
              />
            </section>

            {stats.topTags.length > 0 && (
              <section className="panel">
                <header className="panel-head">
                  <h2>Top tags</h2>
                </header>
                <BarList
                  data={stats.topTags.map(entry => ({ label: entry.key, value: entry.plays }))}
                />
              </section>
            )}

            <section className="panel panel-wide">
              <header className="panel-head">
                <h2>Most played</h2>
                <span className="hint">{STATS_RANGE_LABELS[range]}</span>
              </header>

              <div className="top-song-list">
                {stats.topSongs.slice(0, 10).map((entry, index) => {
                  const song = songById.get(entry.songId)
                  return (
                    <button
                      key={entry.songId}
                      type="button"
                      className="top-song-row"
                      onClick={() => song && player.playSong(song)}
                      disabled={!song}
                    >
                      <span className="top-song-rank">{index + 1}</span>
                      {song ? (
                        <Cover song={song} size={34} />
                      ) : (
                        <span
                          className="cover cover-placeholder"
                          style={{ width: 34, height: 34 }}
                        />
                      )}
                      <span className="top-song-meta">
                        <span className="top-song-title">{entry.title}</span>
                        <span className="top-song-artist">{entry.artist || 'Unknown artist'}</span>
                      </span>
                      <span className="top-song-plays">
                        {entry.plays} {entry.plays === 1 ? 'play' : 'plays'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            {recentSongs.length > 0 && (
              <section className="panel panel-wide">
                <header className="panel-head">
                  <h2>Recently played</h2>
                </header>
                <div className="history-list is-columns">
                  {recentSongs.slice(0, 24).map(event => {
                    const song = songById.get(event.songId)
                    return (
                      <button
                        key={event.songId}
                        type="button"
                        className="history-row"
                        onClick={() => song && player.playSong(song)}
                        disabled={!song}
                      >
                        {song ? (
                          <Cover song={song} size={34} />
                        ) : (
                          <span
                            className="cover cover-placeholder"
                            style={{ width: 34, height: 34 }}
                          />
                        )}
                        <span className="history-meta">
                          <span className="history-title">{event.title}</span>
                          <span className="history-artist">{event.artist || 'Unknown artist'}</span>
                        </span>
                        <span className="history-time">{formatRelative(event.playedAt)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' })
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}
