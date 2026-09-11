import { formatDuration, formatLongDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useDragReorder } from '../lib/hooks.js'
import { Cover } from './Cover.js'
import { FeatureBadges } from './FeatureBadges.js'
import { Equalizer, Grip, Queue, Trash, X } from './Icons.js'

const AUTOMIX_HINT =
  "Reorder what's coming up into a smooth path and pick a crossfade for each transition"

/**
 * Up next.
 *
 * Reordering uses pointer events rather than HTML5 drag-and-drop, because HTML5
 * DnD simply does not exist on touch devices — and rearranging a queue on the
 * phone is most of the reason this panel is here.
 */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const { dragging, over, start, enter, end } = useDragReorder(player.reorderQueue)

  const upcoming = player.queueSongs.slice(player.queue.index + 1)
  const remainingSeconds = upcoming.reduce((sum, song) => sum + song.duration, 0)

  return (
    <aside className="side-panel queue-panel">
      <header className="side-panel-head">
        <div className="side-panel-titles">
          <div className="side-panel-title">Up next</div>
          <div className="side-panel-sub">
            {player.queueSongs.length === 0
              ? 'Nothing playing'
              : upcoming.length === 0
                ? 'Nothing after this one'
                : `${upcoming.length} ${upcoming.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(remainingSeconds)} left`}
          </div>
        </div>
        <div className="side-panel-actions">
          {player.queueSongs.length > 0 && (
            <button
              type="button"
              className="icon-button"
              onClick={player.clearQueue}
              aria-label="Clear queue"
              data-tip="Clear queue"
            >
              <Trash size={17} />
            </button>
          )}
          <button
            type="button"
            className="icon-button side-panel-close"
            onClick={onClose}
            aria-label="Close queue"
            data-tip="Close"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      {/*
        Auto-mix used to sit inside the header, between the title and the close
        button, where it had no room for its own label. Its own row gives it the
        space to say what it is doing.
      */}
      <div className="queue-toolbar">
        <label className="automix-toggle" data-tip={AUTOMIX_HINT}>
          <input
            type="checkbox"
            className="toggle toggle-small"
            checked={player.autoMix}
            onChange={event => player.setAutoMix(event.target.checked)}
            aria-label="Auto-mix"
          />
          <span className="automix-label">Auto-mix</span>
        </label>
        <span className="automix-fade">
          {player.autoMix
            ? upcoming.length > 0
              ? `next crossfade ${player.nextCrossfadeSeconds}s`
              : 'nothing to mix yet'
            : 'plays in queue order'}
        </span>
      </div>

      <div className="queue-list" onPointerUp={end} onPointerCancel={end}>
        {player.queueSongs.length === 0 && (
          <div className="panel-empty">
            <span className="panel-empty-icon">
              <Queue size={20} />
            </span>
            <span className="panel-empty-title">Nothing queued</span>
            <p>
              Play a song to start a queue, or use <strong>Add to queue</strong> on any song.
            </p>
          </div>
        )}

        {player.queueSongs.map((song, index) => {
          const isCurrent = index === player.queue.index
          const isPast = index < player.queue.index

          return (
            <div
              key={`${song.id}-${index}`}
              className={[
                'queue-row',
                isCurrent ? 'is-current' : '',
                isPast ? 'is-past' : '',
                dragging === index ? 'is-dragging' : '',
                over === index && dragging !== null && dragging !== index ? 'is-drop-target' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerEnter={() => enter(index)}
              onDoubleClick={() => player.jumpTo(index)}
            >
              <button
                type="button"
                className="queue-grip"
                onPointerDown={event => start(index, event)}
                aria-label={`Reorder ${song.title}`}
                data-tip="Drag to reorder"
              >
                <Grip size={16} />
              </button>

              <button
                type="button"
                className="queue-main"
                onClick={() => player.jumpTo(index)}
                aria-label={`Play ${song.title}`}
              >
                {isCurrent ? (
                  <span className="queue-marker" data-tip="Playing now">
                    <Equalizer />
                  </span>
                ) : (
                  <Cover song={song} size={34} />
                )}
                <span className="queue-meta">
                  <span className="queue-title">{song.title}</span>
                  <span className="queue-artist">
                    <span className="queue-artist-name">{song.artist || 'Unknown artist'}</span>
                    {/* Auto-mix orders the queue by tempo and key, so here —
                        and only here — the key is worth showing. */}
                    {player.autoMix && <FeatureBadges features={song.features} showKey />}
                  </span>
                </span>
                <span className="queue-duration">{formatDuration(song.duration)}</span>
              </button>

              <button
                type="button"
                className="icon-button queue-remove"
                onClick={() => player.removeFromQueue(index)}
                aria-label={`Remove ${song.title} from queue`}
                data-tip="Remove from queue"
              >
                <X size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
