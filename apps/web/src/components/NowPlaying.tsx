import { useState } from 'react'
import { formatDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useSimilar, useToggleLoved } from '../lib/queries.js'
import { Cover } from './Cover.js'
import { FeatureBadges } from './FeatureBadges.js'
import { LyricsPanel } from './LyricsPanel.js'
import { QueuePanel } from './QueuePanel.js'
import {
  ChevronDown,
  Heart,
  Mic,
  Moon,
  Next,
  Pause,
  Play,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Shuffle,
} from './Icons.js'

/**
 * The full-screen phone player.
 *
 * Large artwork, thumb-reachable controls, and a scrubber with a hit area big
 * enough to actually grab while walking. Lyrics and queue slide over it rather
 * than replacing it, so getting back is always one tap.
 */
export function NowPlaying({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const [panel, setPanel] = useState<'none' | 'lyrics' | 'queue'>('none')
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  const song = player.current
  const similar = useSimilar(song?.id ?? null, 10)
  if (!song) return null

  const displayTime = scrubbing ?? player.currentTime
  const duration = player.duration || song.duration || 0
  const percent = duration > 0 ? (displayTime / duration) * 100 : 0

  return (
    <div className="now-playing">
      <header className="now-playing-head">
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close now playing"
        >
          <ChevronDown size={24} />
        </button>
        <span className="now-playing-context">
          {player.queue.shuffle ? 'Shuffling' : 'Playing'} · {player.queue.index + 1} of{' '}
          {player.queue.items.length}
        </span>
        <button
          type="button"
          className={`icon-button ${song.loved ? 'is-loved' : ''}`}
          onClick={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
          aria-label={song.loved ? 'Unlove' : 'Love'}
        >
          <Heart size={22} filled={song.loved} />
        </button>
      </header>

      {panel === 'none' && (
        <>
          <div className="now-playing-art">
            <Cover song={song} size={320} className="now-playing-cover" />
          </div>

          <div className="now-playing-meta">
            <h1 className="now-playing-title">{song.title}</h1>
            <p className="now-playing-artist">{song.artist || 'Unknown artist'}</p>
            {song.album && <p className="now-playing-album">{song.album}</p>}
            {song.features && (
              <p className="now-playing-features">
                <FeatureBadges features={song.features} size="large" />
              </p>
            )}
          </div>

          <div className="now-playing-progress">
            <input
              className="scrubber scrubber-large"
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(displayTime, duration || 1)}
              style={{ '--progress': `${percent}%` } as React.CSSProperties}
              aria-label="Seek"
              onChange={event => setScrubbing(Number(event.target.value))}
              onPointerUp={() => {
                if (scrubbing !== null) player.seek(scrubbing)
                setScrubbing(null)
              }}
            />
            <div className="now-playing-times">
              <span>{formatDuration(displayTime)}</span>
              <span>-{formatDuration(Math.max(0, duration - displayTime))}</span>
            </div>
          </div>

          <div className="now-playing-controls">
            <button
              type="button"
              className={`icon-button ${player.queue.shuffle ? 'is-accent' : ''}`}
              onClick={player.toggleShuffle}
              aria-label="Shuffle"
            >
              <Shuffle size={20} />
            </button>
            <button
              type="button"
              className="icon-button icon-button-large"
              onClick={player.previous}
              aria-label="Previous"
            >
              <Prev size={30} />
            </button>
            <button
              type="button"
              className="play-button play-button-large"
              onClick={player.toggle}
              aria-label={player.playing ? 'Pause' : 'Play'}
            >
              {player.playing ? <Pause size={30} /> : <Play size={30} />}
            </button>
            <button
              type="button"
              className="icon-button icon-button-large"
              onClick={player.next}
              aria-label="Next"
            >
              <Next size={30} />
            </button>
            <button
              type="button"
              className={`icon-button ${player.queue.repeat !== 'off' ? 'is-accent' : ''}`}
              onClick={player.cycleRepeatMode}
              aria-label={`Repeat: ${player.queue.repeat}`}
            >
              {player.queue.repeat === 'one' ? <RepeatOne size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          {similar.data && similar.data.songs.length > 0 && (
            <section className="similar-strip" aria-label="Similar songs">
              <div className="similar-strip-head">
                <span>Similar</span>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => player.addToQueue(similar.data.songs)}
                >
                  Queue all
                </button>
              </div>
              <div className="similar-strip-list">
                {similar.data.songs.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="similar-card"
                    onClick={() =>
                      player.playFrom(
                        [item, ...similar.data.songs.filter(s => s.id !== item.id)],
                        0,
                      )
                    }
                    title={`${item.title} — ${item.artist || 'Unknown artist'}`}
                  >
                    <Cover song={item} size={64} />
                    <span className="similar-card-title">{item.title}</span>
                    <span className="similar-card-artist">{item.artist || 'Unknown artist'}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {panel === 'lyrics' && <LyricsPanel onClose={() => setPanel('none')} />}
      {panel === 'queue' && <QueuePanel onClose={() => setPanel('none')} />}

      <footer className="now-playing-foot">
        <button
          type="button"
          className={`icon-button ${panel === 'lyrics' ? 'is-accent' : ''}`}
          onClick={() => setPanel(current => (current === 'lyrics' ? 'none' : 'lyrics'))}
          aria-label="Lyrics"
        >
          <Mic size={20} />
        </button>
        <button
          type="button"
          className={`icon-button ${player.sleepTimerEndsAt ? 'is-accent' : ''}`}
          onClick={() => player.setSleepTimer(player.sleepTimerEndsAt ? null : 30)}
          aria-label="Sleep timer"
          title={player.sleepTimerEndsAt ? 'Cancel sleep timer' : 'Sleep in 30 minutes'}
        >
          <Moon size={20} />
        </button>
        <button
          type="button"
          className={`icon-button ${panel === 'queue' ? 'is-accent' : ''}`}
          onClick={() => setPanel(current => (current === 'queue' ? 'none' : 'queue'))}
          aria-label="Queue"
        >
          <Queue size={20} />
        </button>
      </footer>
    </div>
  )
}
