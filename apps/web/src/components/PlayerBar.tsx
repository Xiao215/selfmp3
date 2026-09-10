import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useToggleLoved } from '../lib/queries.js'
import { useIsMobile } from '../lib/hooks.js'
import { DevicesButton } from '../devices/DevicesButton.js'
import { useDeviceContext } from '../devices/DevicesProvider.js'
import { useTransport } from '../devices/useTransport.js'
import { loopRegionPercent } from '../player/practice.js'
import { Cover } from './Cover.js'
import {
  Heart,
  Metronome,
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
import { Popover } from './Menu.js'

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
  onOpenPractice,
  onOpenNowPlaying,
  lyricsOpen,
  queueOpen,
  practiceOpen,
}: {
  onOpenLyrics: () => void
  onOpenQueue: () => void
  onOpenPractice: () => void
  onOpenNowPlaying: () => void
  lyricsOpen: boolean
  queueOpen: boolean
  practiceOpen: boolean
}) {
  const player = usePlayer()
  // Local unless remote control is on, in which case the same controls drive
  // another device and show its progress instead.
  const transport = useTransport()
  const toggleLoved = useToggleLoved()
  const isMobile = useIsMobile()
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  const speedRef = useRef<HTMLButtonElement>(null)
  const sleepRef = useRef<HTMLButtonElement>(null)

  const song = transport.song
  // While dragging, show the handle position rather than the playhead, or the
  // thumb fights the user for control.
  const displayTime = scrubbing ?? transport.currentTime
  const duration = transport.duration || song?.duration || 0
  const percent = duration > 0 ? (displayTime / duration) * 100 : 0
  const loopRegion = loopRegionPercent(player.loopA, player.loopB, duration)

  if (isMobile) {
    return <MiniPlayer onOpen={onOpenNowPlaying} percent={percent} />
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
            onClick={transport.previous}
            aria-label="Previous"
            disabled={!song}
          >
            <Prev size={20} />
          </button>

          <button
            type="button"
            className="play-button"
            onClick={transport.toggle}
            aria-label={transport.playing ? 'Pause' : 'Play'}
            disabled={!song}
          >
            {transport.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={transport.next}
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
          <div className="scrubber-wrap">
            {loopRegion && (
              <div
                className="loop-region"
                style={{ left: `${loopRegion.left}%`, width: `${loopRegion.width}%` }}
                aria-hidden="true"
              />
            )}
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
                if (scrubbing !== null) transport.seek(scrubbing)
                setScrubbing(null)
              }}
              onKeyUp={() => {
                if (scrubbing !== null) transport.seek(scrubbing)
                setScrubbing(null)
              }}
            />
          </div>
          <span className="time">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        {player.stalled && <span className="spinner" aria-label="Buffering" />}

        <DevicesButton />

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

        <button
          type="button"
          className={`icon-button ${practiceOpen || player.loopB !== null ? 'is-accent' : ''}`}
          onClick={onOpenPractice}
          aria-label="Practice tools"
          title="Practice: A–B loop, speed, transpose"
        >
          <Metronome size={17} />
        </button>

        <div className="popover-anchor">
          <button
            ref={speedRef}
            type="button"
            className={`icon-button ${player.rate !== 1 ? 'is-accent' : ''}`}
            onClick={() => setSpeedOpen(open => !open)}
            aria-label="Playback speed"
            aria-haspopup="menu"
            aria-expanded={speedOpen}
            title={`Speed: ${player.rate}×`}
          >
            <Speed size={17} />
          </button>
          {speedOpen && (
            <SpeedMenu
              anchorRef={speedRef}
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
            ref={sleepRef}
            type="button"
            className={`icon-button ${player.sleepTimerEndsAt ? 'is-accent' : ''}`}
            onClick={() => setSleepOpen(open => !open)}
            aria-label="Sleep timer"
            aria-haspopup="menu"
            aria-expanded={sleepOpen}
            title="Sleep timer"
          >
            <Moon size={17} />
          </button>
          {sleepOpen && <SleepMenu anchorRef={sleepRef} onClose={() => setSleepOpen(false)} />}
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={player.toggleMute}
          aria-label={player.muted ? 'Unmute' : 'Mute'}
          disabled={transport.remote !== null}
        >
          {player.muted || player.volume === 0 ? <VolumeMute size={17} /> : <Volume size={17} />}
        </button>

        <input
          className="volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={transport.volume}
          style={{ '--progress': `${transport.volume * 100}%` } as React.CSSProperties}
          aria-label="Volume"
          onChange={event => transport.setVolume(Number(event.target.value))}
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
  const transport = useTransport()
  const song = transport.song

  // Nothing here, but the Mac is playing: a one-line strip is the only way to
  // reach handoff from a phone that is otherwise idle.
  if (!song) return <RemoteOnlyStrip />

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
        <div className="mini-artist">
          {transport.remote ? `on ${transport.remote.name}` : song.artist || 'Unknown artist'}
        </div>
      </div>

      <div className="mini-devices">
        <DevicesButton showChip={false} />
      </div>

      <button
        type="button"
        className="icon-button mini-play"
        onClick={transport.toggle}
        aria-label={transport.playing ? 'Pause' : 'Play'}
      >
        {transport.playing ? <Pause size={22} /> : <Play size={22} />}
      </button>

      <button
        type="button"
        className="icon-button mini-next"
        onClick={transport.next}
        aria-label="Next"
      >
        <Next size={20} />
      </button>
    </div>
  )
}

/** Shown on a phone that has nothing loaded while another device is playing. */
function RemoteOnlyStrip() {
  const { playingElsewhere } = useDeviceContext()
  if (!playingElsewhere) return null

  return (
    <div className="mini-player mini-player-remote">
      <DevicesButton />
    </div>
  )
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function SpeedMenu({
  anchorRef,
  current,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  current: number
  onPick: (rate: number) => void
  onClose: () => void
}) {
  return (
    <Popover
      anchorRef={anchorRef}
      onClose={onClose}
      placement="above"
      label="Playback speed"
      sheet
      roving
    >
      {SPEEDS.map(rate => (
        <button
          key={rate}
          type="button"
          role="menuitemradio"
          aria-checked={current === rate}
          className={`popover-item ${current === rate ? 'is-active' : ''}`}
          onClick={() => onPick(rate)}
        >
          {rate}×{rate === 1 && ' (normal)'}
        </button>
      ))}
    </Popover>
  )
}

const SLEEP_OPTIONS = [15, 30, 45, 60, 90] as const

function SleepMenu({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
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
    <Popover
      anchorRef={anchorRef}
      onClose={onClose}
      placement="above"
      label="Sleep timer"
      sheet
      roving
    >
      <div className="popover-title">
        {player.sleepTimerEndsAt ? `Stopping in ${remaining}` : 'Sleep timer'}
      </div>
      {SLEEP_OPTIONS.map(minutes => (
        <button
          key={minutes}
          type="button"
          role="menuitem"
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
          role="menuitem"
          className="popover-item is-danger"
          onClick={() => {
            player.setSleepTimer(null)
            onClose()
          }}
        >
          Cancel timer
        </button>
      )}
    </Popover>
  )
}
