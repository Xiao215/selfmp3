import { formatDuration, formatLongDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useDragReorder } from '../lib/hooks.js'
import { Cover } from './Cover.js'
import { Equalizer, Grip, Trash, X } from './Icons.js'

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
            {upcoming.length === 0
              ? 'Nothing queued'
              : `${upcoming.length} songs · ${formatLongDuration(remainingSeconds)} left`}
          </div>
        </div>
        <div className="side-panel-actions">
          {player.queueSongs.length > 0 && (
            <button
              type="button"
              className="icon-button"
              onClick={player.clearQueue}
              aria-label="Clear queue"
              title="Clear queue"
            >
              <Trash size={16} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close queue">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="queue-list" onPointerUp={end} onPointerCancel={end}>
        {player.queueSongs.length === 0 && (
          <p className="empty-hint">
            Play something, or use <strong>Add to queue</strong> on any song.
          </p>
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
                title="Drag to reorder"
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
                  <span className="queue-marker">
                    <Equalizer />
                  </span>
                ) : (
                  <Cover song={song} size={34} />
                )}
                <span className="queue-meta">
                  <span className="queue-title">{song.title}</span>
                  <span className="queue-artist">{song.artist || 'Unknown artist'}</span>
                </span>
                <span className="queue-duration">{formatDuration(song.duration)}</span>
              </button>

              <button
                type="button"
                className="icon-button"
                onClick={() => player.removeFromQueue(index)}
                aria-label={`Remove ${song.title} from queue`}
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
