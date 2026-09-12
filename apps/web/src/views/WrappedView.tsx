import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatLongDuration, WRAPPED_RANGE_LABELS, type WrappedRange } from '@selfmp3/shared'
import { useLibrary, useWrapped } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { mediaUrl } from '../lib/api.js'
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
 * This is the one screen in the app allowed to be a bit of a show: the hero
 * borrows the top song's artwork as a blurred backdrop, the figure is set
 * large, and each section is a numbered chapter. It stays inside the app's
 * type scale, spacing and accent, so it reads as the same product wearing its
 * good coat rather than as a different app.
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
    /*
     * An empty window is almost always the wrong window, so the way out is
     * offered rather than described: the longer ranges are one tap away.
     */
    const longer = RANGES.slice(RANGES.indexOf(range) + 1)
    return (
      <section className="view wrapped-view">
        {header}
        <div className="empty-state">
          <p className="empty-emoji">🎁</p>
          <h2>Nothing in {range === 'all' ? 'your history' : 'this window'} yet</h2>
          <p className="hint">
            {range === 'all'
              ? 'Play something and Wrapped starts keeping score — the first minute counts.'
              : `You have no plays in the ${WRAPPED_RANGE_LABELS[range].toLowerCase()}. Try a longer window, or go and put something on.`}
          </p>
          <div className="button-row wrapped-empty-actions">
            {longer.map(option => (
              <button
                key={option}
                type="button"
                className="button"
                onClick={() => setRange(option)}
              >
                Try {RANGE_SHORT[option].toLowerCase()}
              </button>
            ))}
            <Link to="/" className="button button-primary">
              <Play size={15} /> Go to the library
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const topSong = wrapped.topSongs[0]
  const topSongInLibrary = topSong ? songById.get(topSong.songId) : undefined
  const hero = topSong?.hasArt ? mediaUrl.art(topSong.songId) : null

  return (
    <section className="view wrapped-view">
      {header}

      {shareError && (
        <p className="notice notice-error" role="alert">
          {shareError}
        </p>
      )}

      <div className="wrapped-hero">
        {/*
         * The top song's artwork, blurred well past recognition, as the hero's
         * ground. It is the one image on the page and it is always the right
         * one — decoration that is also data.
         */}
        {hero && (
          <div
            className="wrapped-hero-art"
            style={{ backgroundImage: `url(${hero})` }}
            aria-hidden="true"
          />
        )}

        <div className="wrapped-hero-inner">
          <div className="wrapped-hero-main">
            <p className="wrapped-eyebrow">{WRAPPED_RANGE_LABELS[range]} · you listened for</p>
            <p className="wrapped-figure">{Math.round(wrapped.totals.minutes).toLocaleString()}</p>
            {/* The hours form only earns its place once there are hours to show;
                below that it just repeats the number above it. */}
            <p className="wrapped-figure-unit">
              minutes
              {wrapped.totals.minutes >= 60 &&
                ` · ${formatLongDuration(wrapped.totals.minutes * 60)}`}
            </p>

            {wrapped.personality.traits.length > 0 && (
              <ul className="wrapped-traits" aria-label="Your listening traits">
                {wrapped.personality.traits.map(trait => (
                  <li key={trait} className="wrapped-trait">
                    <Sparkles size={13} /> {trait}
                  </li>
                ))}
              </ul>
            )}
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
              hint={wrapped.peakHour ? `${plays(wrapped.peakHour.plays)}` : undefined}
            />
            <Fact
              label="Best day"
              value={wrapped.peakWeekday ? (WEEKDAYS[wrapped.peakWeekday.weekday] ?? '—') : '—'}
              hint={wrapped.peakWeekday ? `${plays(wrapped.peakWeekday.plays)}` : undefined}
            />
          </dl>
        </div>
      </div>

      <div className="wrapped-chapters">
        <section className="panel wrapped-panel wrapped-songs">
          <header className="panel-head">
            <h2>
              <span className="wrapped-chapter-no">01</span> Top songs
            </h2>
            {wrapped.topSongs.length > 0 && (
              <button
                type="button"
                className="button button-small"
                onClick={() => playTop(wrapped.topSongs.map(song => song.songId))}
              >
                <Play size={13} /> Play all
              </button>
            )}
          </header>

          {/* The number one gets to be a picture, not a row. */}
          {topSong && (
            <button
              type="button"
              className="wrapped-number-one"
              onClick={() => topSongInLibrary && player.playSong(topSongInLibrary)}
              disabled={!topSongInLibrary}
            >
              {topSongInLibrary ? (
                <Cover song={topSongInLibrary} size={92} className="wrapped-number-one-art" />
              ) : (
                <span className="cover cover-placeholder" style={{ width: 92, height: 92 }} />
              )}
              <span className="wrapped-number-one-text">
                <span className="wrapped-number-one-label">Your number one</span>
                <span className="wrapped-number-one-title">{topSong.title}</span>
                <span className="wrapped-number-one-artist">
                  {topSong.artist || 'Unknown artist'}
                </span>
                <span className="wrapped-number-one-plays">
                  {plays(topSong.plays)} · {Math.round(topSong.minutes)} minutes
                </span>
              </span>
            </button>
          )}

          {wrapped.topSongs.length > 1 && (
            <div className="top-song-list">
              {wrapped.topSongs.slice(1).map((entry, index) => {
                const song = songById.get(entry.songId)
                return (
                  <button
                    key={entry.songId}
                    type="button"
                    className="top-song-row"
                    onClick={() => song && player.playSong(song)}
                    disabled={!song}
                  >
                    <span className="top-song-rank">{index + 2}</span>
                    {song ? (
                      <Cover song={song} size={34} />
                    ) : (
                      <span className="cover cover-placeholder" style={{ width: 34, height: 34 }} />
                    )}
                    <span className="top-song-meta">
                      <span className="top-song-title">{entry.title}</span>
                      <span className="top-song-artist">{entry.artist || 'Unknown artist'}</span>
                    </span>
                    <span className="top-song-plays">{plays(entry.plays)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel wrapped-panel">
          <header className="panel-head">
            <h2>
              <span className="wrapped-chapter-no">02</span> Top artists
            </h2>
          </header>
          <RankList entries={wrapped.topArtists} max={wrapped.topArtists[0]?.plays ?? 1} />

          {wrapped.topTags.length > 0 && (
            <>
              <h3 className="wrapped-subhead">Top tags</h3>
              <RankList entries={wrapped.topTags} max={wrapped.topTags[0]?.plays ?? 1} />
            </>
          )}
        </section>

        {wrapped.mostInOneDay && (
          <section className="panel wrapped-panel wrapped-repeat">
            <header className="panel-head">
              <h2>
                <span className="wrapped-chapter-no">03</span> On repeat
              </h2>
              <span className="hint">{longDate(wrapped.mostInOneDay.date)}</span>
            </header>
            <p className="wrapped-repeat-figure">
              {wrapped.mostInOneDay.plays}
              <span>×</span>
            </p>
            <p className="wrapped-repeat-song">
              <strong>{wrapped.mostInOneDay.title}</strong>
              <span className="hint"> — {wrapped.mostInOneDay.artist || 'Unknown artist'}</span>
            </p>
            <p className="hint">
              The most you played one song in a single day
              {wrapped.busiestDate && ` · busiest day overall: ${plays(wrapped.busiestDate.plays)}`}
              .
            </p>
          </section>
        )}

        <section className="panel wrapped-panel">
          <header className="panel-head">
            <h2>
              <span className="wrapped-chapter-no">{wrapped.mostInOneDay ? '04' : '03'}</span>{' '}
              Discovered
            </h2>
            {wrapped.discovered.length > 0 && (
              <button
                type="button"
                className="button button-small"
                onClick={() => playTop(wrapped.discovered.map(song => song.songId))}
              >
                <Play size={13} /> Play all
              </button>
            )}
          </header>

          {wrapped.discovered.length === 0 ? (
            <p className="hint">
              Nothing new stuck in this window — a song counts once you have added it and played it
              three times.
            </p>
          ) : (
            <RankList
              entries={wrapped.discovered.slice(0, 8).map(song => ({
                key: song.title,
                sub: song.artist || 'Unknown artist',
                plays: song.plays,
              }))}
              max={wrapped.discovered[0]?.plays ?? 1}
            />
          )}
        </section>
      </div>
    </section>
  )
}

/**
 * A ranked list where each row carries its own share of the total as a quiet
 * bar behind the name — the same information the number gives, in a form the
 * eye reads without counting.
 */
function RankList({
  entries,
  max,
}: {
  entries: ReadonlyArray<{ key: string; plays: number; sub?: string }>
  max: number
}) {
  if (entries.length === 0) return <p className="chart-empty">Nothing here yet</p>

  return (
    <ol className="wrapped-rank-list">
      {entries.map((entry, index) => (
        <li key={`${entry.key}-${index}`}>
          <span
            className="wrapped-rank-bar"
            style={{ width: `${Math.max(6, (entry.plays / Math.max(max, 1)) * 100)}%` }}
            aria-hidden="true"
          />
          <span className="wrapped-rank">{index + 1}</span>
          <span className="wrapped-rank-name">
            {entry.key}
            {entry.sub && <span className="hint"> — {entry.sub}</span>}
          </span>
          <span className="wrapped-rank-value">{entry.plays}</span>
        </li>
      ))}
    </ol>
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

function plays(count: number): string {
  return `${count} ${count === 1 ? 'play' : 'plays'}`
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
