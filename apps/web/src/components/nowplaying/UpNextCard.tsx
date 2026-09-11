import { usePlayer } from '../../player/PlayerProvider.js'
import { Cover } from '../Cover.js'
import { Next } from '../Icons.js'

/** How close to the end the card slides in. */
const LEAD_SECONDS = 15

/**
 * "Next: …", for the last few seconds of a song.
 *
 * It says what is coming without anyone opening the queue, and clicking it
 * skips there. Nothing to dismiss: it goes when the song does. Not shown on
 * repeat-one, where nothing else is coming.
 */
export function UpNextCard() {
  const player = usePlayer()
  const next = player.queueSongs[player.queue.index + 1]
  const remaining = player.duration - player.currentTime

  const showing =
    next !== undefined &&
    player.queue.repeat !== 'one' &&
    player.duration > LEAD_SECONDS * 2 &&
    remaining > 0 &&
    remaining <= LEAD_SECONDS

  if (!showing) return null

  return (
    <button
      type="button"
      className="up-next-card"
      onClick={player.next}
      aria-label={`Skip to the next song: ${next.title}`}
    >
      <Cover song={next} size={40} />
      <span className="up-next-text">
        <span className="up-next-label">Next · in {Math.ceil(remaining)} s</span>
        <span className="up-next-title">{next.title}</span>
        <span className="up-next-artist">{next.artist || 'Unknown artist'}</span>
      </span>
      <Next size={16} />
    </button>
  )
}
