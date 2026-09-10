import { useEffect, useState } from 'react'
import { formatDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useToggleLoved } from '../lib/queries.js'
import { useIsMobile } from '../lib/hooks.js'
import { Cover } from './Cover.js'
import {
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
  Speed,
  Volume,
  VolumeMute,
} from './Icons.js'

/**
 * The transport bar.
 *
 * On a phone it collapses to a compact strip above the tab bar — tapping it
 * opens the full-screen now-playing view, which is the interaction people
 * already expect from every other music app.
 */
export function PlayerBar({
  onOpenLyrics,
  onOpenQueue,
  onOpenNowPlaying,
  lyricsOpen,
  queueOpen,
}: {
  onOpenLyrics: () => void
  onOpenQueue: () => void
  onOpenNowPlaying: () => void
  lyricsOpen: boolean
  queueOpen: boolean
}) {
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const isMobile = useIsMobile()
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)

  const song = player.current
  // While dragging, show the handle position rather than the playhead, or the
  // thumb fights the user for control.
  const displayTime = scrubbing ?? player.currentTime
  const duration = player.duration || song?.duration || 0
  const percent = duration > 0 ? (displayTime / duration) * 100 : 0

  if (isMobile) {
    return (
      <MiniPlayer
        onOpen={onOpenNowPlaying}
        percent={percent}
      />
    )
  }

  return (
    <footer className="player-bar">
      <div className="player-left">
        {song ? (
          <>
            <Cover song={song} size={54} />
            <div className="player-meta">
              <div className="player-title" title={song.title}>
                {song.title}
              </div>
              <div className="player-artist">{song.artist || 'Unknown artist'}</div>
            </div>
            <button
              type="button"
              className={`icon-button ${song.loved ? 'is-loved' : ''}`}
              onClick={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
              aria-label={song.loved ? 'Unlove' : 'Love'}
            >
              <Heart size={17} filled={song.loved} />
            </button>
          </>
        ) : (
          <div className="player-meta">
            <div className="player-artist">Nothing playing</div>
          </div>
        )}
      </div>

      <div className="player-center">
        <div className="player-buttons">
          <button
            type="button"
            className={`icon-button ${player.queue.shuffle ? 'is-accent' : ''}`}
            onClick={player.toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={player.queue.shuffle}
            title="Shuffle"
          >
            <Shuffle size={17} />
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={player.previous}
            aria-label="Previous"
            disabled={!song}
          >
            <Prev size={20} />
          </button>

          <button
            type="button"
            className="play-button"
            onClick={player.toggle}
            aria-label={player.playing ? 'Pause' : 'Play'}
            disabled={!song}
          >
            {player.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={player.next}
            aria-label="Next"
            disabled={!song}
          >
            <Next size={20} />
          </button>

          <button
            type="button"
            className={`icon-button ${player.queue.repeat !== 'off' ? 'is-accent' : ''}`}
            onClick={player.cycleRepeatMode}
            aria-label={`Repeat: ${player.queue.repeat}`}
            title={`Repeat: ${player.queue.repeat}`}
          >
            {player.queue.repeat === 'one' ? <RepeatOne size={17} /> : <Repeat size={17} />}
          </button>
        </div>

        <div className="player-progress">
          <span className="time">{formatDuration(displayTime)}</span>
          <input
            className="scrubber"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(displayTime, duration || 1)}
            style={{ '--progress': `${percent}%` } as React.CSSProperties}
            disabled={!song}
            aria-label="Seek"
            onChange={event => setScrubbing(Number(event.target.value))}
            onPointerUp={() => {
              if (scrubbing !== null) player.seek(scrubbing)
              setScrubbing(null)
            }}
            onKeyUp={() => {
              if (scrubbing !== null) player.seek(scrubbing)
              setScrubbing(null)
            }}
          />
          <span className="time">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        {player.stalled && <span className="spinner" aria-label="Buffering" />}

        <button
          type="button"
          className={`icon-button ${lyricsOpen ? 'is-accent' : ''}`}
          onClick={onOpenLyrics}
          aria-label="Lyrics"
          title="Lyrics"
        >
          <Mic size={17} />
        </button>

        <button
          type="button"
          className={`icon-button ${queueOpen ? 'is-accent' : ''}`}
          onClick={onOpenQueue}
          aria-label="Queue"
          title="Queue"
        >
          <Queue size={17} />
        </button>

        <div className="popover-anchor">
          <button
            type="button"
            className={`icon-button ${player.rate !== 1 ? 'is-accent' : ''}`}
            onClick={() => setSpeedOpen(open => !open)}
            aria-label="Playback speed"
            title={`Speed: ${player.rate}×`}
          >
            <Speed size={17} />
          </button>
          {speedOpen && (
            <SpeedMenu
              current={player.rate}
              onPick={rate => {
                player.setRate(rate)
                setSpeedOpen(false)
              }}
              onClose={() => setSpeedOpen(false)}
            />
          )}
        </div>

        <div className="popover-anchor">
          <button
            type="button"
            className={`icon-button ${player.sleepTimerEndsAt ? 'is-accent' : ''}`}
            onClick={() => setSleepOpen(open => !open)}
            aria-label="Sleep timer"
            title="Sleep timer"
          >
            <Moon size={17} />
          </button>
          {sleepOpen && <SleepMenu onClose={() => setSleepOpen(false)} />}
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={player.toggleMute}
          aria-label={player.muted ? 'Unmute' : 'Mute'}
        >
          {player.muted || player.volume === 0 ? <VolumeMute size={17} /> : <Volume size={17} />}
        </button>

        <input
          className="volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.muted ? 0 : player.volume}
          style={{ '--progress': `${(player.muted ? 0 : player.volume) * 100}%` } as React.CSSProperties}
          aria-label="Volume"
          onChange={event => player.setVolume(Number(event.target.value))}
        />
      </div>
    </footer>
  )
}

/**
 * The compact phone strip.
 *
 * Note the outer element is a div, not a button: it contains its own play and
 * next buttons, and nesting interactive elements is invalid HTML that breaks
 * VoiceOver. The tap-to-expand behaviour is attached to a dedicated overlay
 * button underneath instead.
 */
function MiniPlayer({ onOpen, percent }: { onOpen: () => void; percent: number }) {
  const player = usePlayer()
  const song = player.current

  if (!song) return null

  return (
    <div className="mini-player">
      <div className="mini-progress" style={{ width: `${percent}%` }} />

      <button
        type="button"
        className="mini-expand"
        onClick={onOpen}
        aria-label={`Open now playing: ${song.title}`}
      />

      <Cover song={song} size={40} />
      <div className="mini-meta">
        <div className="mini-title">{song.title}</div>
        <div className="mini-artist">{song.artist || 'Unknown artist'}</div>
      </div>

      <button
        type="button"
        className="icon-button mini-play"
        onClick={player.toggle}
        aria-label={player.playing ? 'Pause' : 'Play'}
      >
        {player.playing ? <Pause size={22} /> : <Play size={22} />}
      </button>

      <button
        type="button"
        className="icon-button mini-next"
        onClick={player.next}
        aria-label="Next"
      >
        <Next size={20} />
      </button>
    </div>
  )
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function SpeedMenu({
  current,
  onPick,
  onClose,
}: {
  current: number
  onPick: (rate: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover popover-up" role="menu">
        {SPEEDS.map(rate => (
          <button
            key={rate}
            type="button"
            className={`popover-item ${current === rate ? 'is-active' : ''}`}
            onClick={() => onPick(rate)}
          >
            {rate}×{rate === 1 && ' (normal)'}
          </button>
        ))}
      </div>
    </>
  )
}

const SLEEP_OPTIONS = [15, 30, 45, 60, 90] as const

function SleepMenu({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    if (player.sleepTimerEndsAt === null) {
      setRemaining('')
      return
    }
    const update = (): void => {
      const ms = Math.max(0, (player.sleepTimerEndsAt ?? 0) - Date.now())
      setRemaining(formatDuration(ms / 1000))
    }
    update()
    const timer = setInterval(update, 1_000)
    return () => clearInterval(timer)
  }, [player.sleepTimerEndsAt])

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover popover-up" role="menu">
        <div className="popover-title">
          {player.sleepTimerEndsAt ? `Stopping in ${remaining}` : 'Sleep timer'}
        </div>
        {SLEEP_OPTIONS.map(minutes => (
          <button
            key={minutes}
            type="button"
            className="popover-item"
            onClick={() => {
              player.setSleepTimer(minutes)
              onClose()
            }}
          >
            {minutes} minutes
          </button>
        ))}
        {player.sleepTimerEndsAt !== null && (
          <button
            type="button"
            className="popover-item is-danger"
            onClick={() => {
              player.setSleepTimer(null)
              onClose()
            }}
          >
            Cancel timer
          </button>
        )}
      </div>
    </>
  )
}
