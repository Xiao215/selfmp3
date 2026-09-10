import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatLongDuration, WRAPPED_RANGE_LABELS, type WrappedRange } from '@selfmp3/shared'
import { useLibrary, useWrapped } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { downloadWrappedCard, readPalette } from '../lib/wrappedCard.js'
import { Cover } from '../components/Cover.js'
import { Download, Play, Sparkles } from '../components/Icons.js'

/**
 * Wrapped, for any window you like.
 *
 * The yearly version of this is a marketing exercise; the useful version is
 * being able to ask "what did last week sound like" on a Tuesday. Everything
 * here comes from the same play events the Stats page uses, so the numbers
 * agree with each other.
 *
 * "Share as image" draws a 1080×1080 card on a canvas rather than
 * screenshotting the page: the result is identical on a phone and a laptop and
 * has no app chrome in it.
 */

const RANGES: readonly WrappedRange[] = ['week', 'month', 'year', 'all']
const RANGE_SHORT: Record<WrappedRange, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  all: 'All time',
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function WrappedView() {
  const [range, setRange] = useState<WrappedRange>('month')
  const { data: wrapped, isLoading } = useWrapped(range)
  const { data: library } = useLibrary()
  const player = usePlayer()
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const songById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )

  const share = async (): Promise<void> => {
    if (!wrapped) return
    setSharing(true)
    setShareError(null)
    try {
      await downloadWrappedCard(wrapped, readPalette())
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'could not make the image')
    } finally {
      setSharing(false)
    }
  }

  /** Play a list of top entries, resolving the ones still in the library. */
  const playTop = (ids: readonly number[]): void => {
    const songs = ids.map(id => songById.get(id)).filter(song => song !== undefined)
    if (songs.length > 0) player.playFrom(songs, 0)
  }

  const header = (
    <header className="view-head">
      <div className="view-titles">
        <h1>Wrapped</h1>
        <p className="view-sub">
          {WRAPPED_RANGE_LABELS[range]} · <Link to="/stats">back to stats</Link>
        </p>
      </div>

      <div className="view-actions">
        <div className="segmented" role="group" aria-label="Wrapped range">
          {RANGES.map(option => (
            <button
              key={option}
              type="button"
              className={`segmented-item ${range === option ? 'is-active' : ''}`}
              onClick={() => setRange(option)}
              aria-pressed={range === option}
            >
              {RANGE_SHORT[option]}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={() => void share()}
          disabled={!wrapped || wrapped.totals.plays === 0 || sharing}
        >
          <Download size={15} /> {sharing ? 'Rendering…' : 'Share as image'}
        </button>
      </div>
    </header>
  )

  if (isLoading && !wrapped) {
    return (
      <section className="view wrapped-view">
        {header}
        <p className="hint">Working it out…</p>
      </section>
    )
  }

  if (!wrapped) {
    return (
      <section className="view wrapped-view">
        {header}
        <div className="empty-state">
          <h2>Wrapped needs your library</h2>
          <p className="hint">It’ll be here when your Mac is reachable again.</p>
        </div>
      </section>
    )
  }

  if (wrapped.totals.plays === 0) {
    return (
      <section className="view wrapped-view">
        {header}
        <div className="empty-state">
          <p className="empty-emoji">🎁</p>
          <h2>Nothing in this window yet</h2>
          <p className="hint">Play something, or try a longer range.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="view wrapped-view">
      {header}

      {shareError && (
        <p className="notice notice-error" role="alert">
          {shareError}
        </p>
      )}

      <div className="wrapped-hero">
        <div className="wrapped-hero-main">
          <p className="wrapped-eyebrow">You listened for</p>
          <p className="wrapped-figure">{Math.round(wrapped.totals.minutes).toLocaleString()}</p>
          {/* The hours form only earns its place once there are hours to show;
              below that it just repeats the number above it. */}
          <p className="wrapped-figure-unit">
            minutes
            {wrapped.totals.minutes >= 60 &&
              ` · ${formatLongDuration(wrapped.totals.minutes * 60)}`}
          </p>
          <p className="wrapped-personality">
            <Sparkles size={16} /> {wrapped.personality.line}
          </p>
        </div>

        <dl className="wrapped-facts">
          <Fact label="Plays" value={wrapped.totals.plays.toLocaleString()} />
          <Fact label="Songs" value={wrapped.totals.songsPlayed.toLocaleString()} />
          <Fact label="Days with music" value={wrapped.totals.activeDays.toLocaleString()} />
          <Fact
            label="Longest streak"
            value={`${wrapped.longestStreakDays} ${wrapped.longestStreakDays === 1 ? 'day' : 'days'}`}
          />
          <Fact
            label="Peak hour"
            value={wrapped.peakHour ? formatHour(wrapped.peakHour.hour) : '—'}
            hint={wrapped.peakHour ? `${wrapped.peakHour.plays} plays` : undefined}
          />
          <Fact
            label="Best day"
            value={wrapped.peakWeekday ? (WEEKDAYS[wrapped.peakWeekday.weekday] ?? '—') : '—'}
            hint={wrapped.peakWeekday ? `${wrapped.peakWeekday.plays} plays` : undefined}
          />
        </dl>
      </div>

      <div className="stats-panels">
        <section className="panel">
          <header className="panel-head">
            <h2>Top songs</h2>
            {wrapped.topSongs.length > 0 && (
              <button
                type="button"
                className="button button-small"
                onClick={() => playTop(wrapped.topSongs.map(song => song.songId))}
              >
                <Play size={13} /> Play
              </button>
            )}
          </header>
          <div className="top-song-list">
            {wrapped.topSongs.map((entry, index) => {
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
                    <span className="cover cover-placeholder" style={{ width: 34, height: 34 }} />
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

        <section className="panel">
          <header className="panel-head">
            <h2>Top artists</h2>
          </header>
          <ol className="wrapped-rank-list">
            {wrapped.topArtists.map((entry, index) => (
              <li key={entry.key}>
                <span className="wrapped-rank">{index + 1}</span>
                <span className="wrapped-rank-name">{entry.key}</span>
                <span className="wrapped-rank-value">{entry.plays}</span>
              </li>
            ))}
          </ol>

          {wrapped.topTags.length > 0 && (
            <>
              <h3 className="wrapped-subhead">Top tags</h3>
              <ol className="wrapped-rank-list">
                {wrapped.topTags.map((entry, index) => (
                  <li key={entry.key}>
                    <span className="wrapped-rank">{index + 1}</span>
                    <span className="wrapped-rank-name">{entry.key}</span>
                    <span className="wrapped-rank-value">{entry.plays}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        {wrapped.mostInOneDay && (
          <section className="panel">
            <header className="panel-head">
              <h2>On repeat</h2>
              <span className="hint">{longDate(wrapped.mostInOneDay.date)}</span>
            </header>
            <p className="panel-figure">{wrapped.mostInOneDay.plays}×</p>
            <p className="wrapped-repeat-song">
              <strong>{wrapped.mostInOneDay.title}</strong>
              <span className="hint"> — {wrapped.mostInOneDay.artist || 'Unknown artist'}</span>
            </p>
            <p className="hint">
              The most you played one song in a single day
              {wrapped.busiestDate && ` · busiest day overall: ${wrapped.busiestDate.plays} plays`}
            </p>
          </section>
        )}

        <section className="panel">
          <header className="panel-head">
            <h2>Discovered</h2>
            {wrapped.discovered.length > 0 && (
              <button
                type="button"
                className="button button-small"
                onClick={() => playTop(wrapped.discovered.map(song => song.songId))}
              >
                <Play size={13} /> Play
              </button>
            )}
          </header>

          {wrapped.discovered.length === 0 ? (
            <p className="hint">
              Nothing new stuck in this window — a song counts once you have added it and played it
              three times.
            </p>
          ) : (
            <ol className="wrapped-rank-list">
              {wrapped.discovered.slice(0, 8).map((song, index) => (
                <li key={song.songId}>
                  <span className="wrapped-rank">{index + 1}</span>
                  <span className="wrapped-rank-name">
                    {song.title}
                    <span className="hint"> — {song.artist || 'Unknown artist'}</span>
                  </span>
                  <span className="wrapped-rank-value">{song.plays}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="wrapped-fact">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="wrapped-fact-hint">{hint}</span>}
      </dd>
    </div>
  )
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' })
}
