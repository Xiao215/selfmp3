import { formatLongDuration, formatRelative } from '@selfmp3/shared'
import { useGems } from '../lib/queries.js'
import { useLocalStorage } from '../lib/hooks.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Cover } from './Cover.js'
import { ChevronDown, ChevronRight, Play, Queue, Sparkles } from './Icons.js'

/**
 * Forgotten gems.
 *
 * Songs you loved or wore out, that have not come up in months. The list is
 * re-ranked with a little randomness server-side on every request, so this is
 * a different handful each time you open the library rather than the same
 * reproach every day.
 *
 * It hides itself when there is nothing to show — including when the server is
 * unreachable — because an error box above the library would be worse than no
 * row at all.
 */
export function GemsRow() {
  const { data, isError } = useGems(12)
  const player = usePlayer()
  const [collapsed, setCollapsed] = useLocalStorage('gems.collapsed', false)

  if (isError || !data || data.songs.length === 0) return null

  /*
   * A shelf of posters is the right shape for a dozen songs and the wrong one
   * for one: a single 90px card marooned in a full-width box reads as a
   * layout that failed. Below four, the same cards lie down and share the
   * width instead.
   */
  const few = data.songs.length <= 3

  return (
    <section className={`gems-row ${few ? 'is-few' : ''}`} aria-label="Forgotten gems">
      <header className="gems-head">
        <button
          type="button"
          className="gems-title"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <span className="gems-title-label">Forgotten gems</span>
          <span className="hint">
            {data.total} {data.total === 1 ? 'song' : 'songs'} you liked, unplayed for{' '}
            {data.minDays}+ days
          </span>
        </button>

        {!collapsed && (
          <div className="gems-actions">
            <button
              type="button"
              className="button button-small"
              onClick={() => player.playFrom(data.songs, 0)}
            >
              <Play size={13} /> Play all
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() => player.addToQueue(data.songs)}
            >
              Add to queue
            </button>
          </div>
        )}
      </header>

      {!collapsed && (
        <div className="gems-list">
          {data.songs.map((song, index) => (
            <button
              key={song.id}
              type="button"
              className="gem-card"
              onClick={() => player.playFrom(data.songs, index)}
              data-tip={`${song.title} — ${song.artist || 'Unknown artist'}`}
            >
              <Cover song={song} size={few ? 44 : 64} className="gem-card-art" />
              <span className="gem-card-text">
                <span className="gem-card-title">{song.title}</span>
                <span className="gem-card-artist">{song.artist || 'Unknown artist'}</span>
                <span className="gem-card-when">
                  {song.lastPlayedAt ? formatRelative(song.lastPlayedAt) : 'never played'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * The same list, as a built-in card among the playlists.
 *
 * It is not a row in the database, so there is nothing to delete or rename —
 * which is the point. Clicking it starts the list rather than opening a detail
 * view, because the list is different every time it is asked for and a page
 * showing "the" forgotten gems would be lying about being stable.
 */
export function GemsPlaylistCard() {
  const { data, isError } = useGems(30)
  const player = usePlayer()

  if (isError || !data || data.songs.length === 0) return null

  const totalDuration = data.songs.reduce((sum, song) => sum + song.duration, 0)

  return (
    <div className="playlist-card">
      <button
        type="button"
        className="playlist-card-main"
        onClick={() => player.playFrom(data.songs, 0)}
      >
        <span className="playlist-card-icon">
          <Sparkles size={22} />
        </span>
        <span className="playlist-card-name">Forgotten gems</span>
        <span className="playlist-card-sub">
          {data.songs.length} songs · {formatLongDuration(totalDuration)}
        </span>
        <span className="playlist-card-desc">
          Built in · loved or well played, quiet for {data.minDays}+ days
        </span>
      </button>

      <div className="playlist-card-actions">
        <button
          type="button"
          className="icon-button"
          onClick={() => player.playFrom(data.songs, 0)}
          aria-label="Play forgotten gems"
        >
          <Play size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => player.addToQueue(data.songs)}
          aria-label="Add forgotten gems to the queue"
          data-tip="Add to queue"
        >
          <Queue size={16} />
        </button>
      </div>
    </div>
  )
}
