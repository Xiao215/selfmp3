import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { activeLineIndex, formatDuration, parseLyrics, type Song } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { api } from '../lib/api.js'
import { useLibrary, useToggleLoved } from '../lib/queries.js'
import { useIsMobile } from '../lib/hooks.js'
import { TagPicker } from './TagPicker.js'
import { DevicesButton } from '../devices/DevicesButton.js'
import { useDeviceContext } from '../devices/DevicesProvider.js'
import { useTransport } from '../devices/useTransport.js'
import { loopRegionPercent } from '../player/practice.js'
import { Cover } from './Cover.js'
import { lyricsQueryKey } from './nowplaying/useSongLyrics.js'
import type { PageMode } from './nowplaying/NowPlayingPage.js'
import {
  ChevronDown,
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
  TagPlus,
  Volume,
  VolumeMute,
} from './Icons.js'
import { Popover } from './Menu.js'

/** Said as a sentence, because "Repeat: off" is not what a screen reader wants. */
const REPEAT_LABEL: Record<'off' | 'all' | 'one', string> = {
  off: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat this song',
}

/**
 * The transport bar.
 *
 * The artwork, title and artist together are the way into the song's own page
 * — the same thing the phone's mini player does, and what people expect from
 * every other music app. On a phone the bar collapses to that compact strip
 * above the tab bar.
 */
export function PlayerBar({
  onToggleLyrics,
  onOpenQueue,
  onOpenPractice,
  onTogglePage,
  page,
  queueOpen,
  practiceOpen,
  tagsOpen,
  onToggleTags,
}: {
  /** The mic, or L: the page in Focus, and again to put it away. */
  onToggleLyrics: () => void
  onOpenQueue: () => void
  onOpenPractice: () => void
  /** The artwork block: open the page, or close it. */
  onTogglePage: () => void
  /** Which mode the page is in, or null while it is closed. */
  page: PageMode | null
  queueOpen: boolean
  practiceOpen: boolean
  /** The tag picker for what is playing, opened here or with T. */
  tagsOpen: boolean
  onToggleTags: () => void
}) {
  const player = usePlayer()
  const { data: library } = useLibrary()
  const tagsRef = useRef<HTMLButtonElement>(null)
  // Local unless remote control is on, in which case the same controls drive
  // another device and show its progress instead.
  const transport = useTransport()
  const toggleLoved = useToggleLoved()
  const isMobile = useIsMobile()
  // Same breakpoint hook, a different question: below this the nine controls on
  // the right no longer fit beside a readable title, so the volume slider folds
  // into its own popover instead of squeezing the track info to two characters.
  const compact = useIsMobile(1160)
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
  const tagNames = (ids: readonly number[]): string =>
    ids
      .map(id => library?.tags.find(tag => tag.id === id)?.name)
      .filter(Boolean)
      .join(', ')

  if (isMobile) {
    return <MiniPlayer onOpen={onTogglePage} percent={percent} />
  }

  return (
    <footer className="player-bar">
      <div className="player-left">
        {song ? (
          <>
            <button
              type="button"
              className={`player-open ${page ? 'is-open' : ''} ${page === null && song.lyricsKind === 'synced' ? 'has-ticker' : ''}`}
              onClick={onTogglePage}
              aria-expanded={page !== null}
              aria-label={page ? 'Close now playing' : `Open now playing: ${song.title}`}
              title={page ? 'Close (Esc)' : 'Open the song: lyrics, up next, details'}
            >
              <span className="player-open-art">
                <Cover song={song} size={54} />
                <span className="player-open-chevron" aria-hidden="true">
                  <ChevronDown size={22} />
                </span>
              </span>
              <span className="player-meta">
                <span className="player-title">{song.title}</span>
                <span className="player-artist">
                  <span className="player-artist-name">{song.artist || 'Unknown artist'}</span>
                  {page === null && <LyricTicker song={song} />}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`icon-button player-love ${song.loved ? 'is-loved' : ''}`}
              onClick={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
              aria-label={song.loved ? 'Unlove' : 'Love'}
              aria-pressed={song.loved}
              title={song.loved ? 'Remove from loved' : 'Love this song'}
            >
              <Heart size={17} filled={song.loved} />
            </button>
            <button
              ref={tagsRef}
              type="button"
              className={`icon-button player-tags ${tagsOpen ? 'is-accent' : ''}`}
              onClick={onToggleTags}
              aria-label={`Tags for ${song.title}`}
              aria-haspopup="dialog"
              aria-expanded={tagsOpen}
              title={
                song.tagIds.length > 0 ? `Tags: ${tagNames(song.tagIds)} (T)` : 'Tag this song (T)'
              }
            >
              <TagPlus size={17} />
              {song.tagIds.length > 0 && (
                <span className="player-tags-count" aria-hidden="true">
                  {song.tagIds.length}
                </span>
              )}
            </button>
            {tagsOpen && (
              <TagPicker
                anchorRef={tagsRef}
                song={song}
                allTags={library?.tags ?? []}
                placement="above"
                onClose={onToggleTags}
              />
            )}
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
            title={`Shuffle ${player.queue.shuffle ? 'on' : 'off'} (S)`}
          >
            <Shuffle size={17} />
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={transport.previous}
            aria-label="Previous"
            title="Previous (⇧←)"
            disabled={!song}
          >
            <Prev size={20} />
          </button>

          <button
            type="button"
            className="play-button"
            onClick={transport.toggle}
            aria-label={transport.playing ? 'Pause' : 'Play'}
            title={`${transport.playing ? 'Pause' : 'Play'} (space)`}
            disabled={!song}
          >
            {transport.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={transport.next}
            aria-label="Next"
            title="Next (⇧→)"
            disabled={!song}
          >
            <Next size={20} />
          </button>

          <button
            type="button"
            className={`icon-button ${player.queue.repeat !== 'off' ? 'is-accent' : ''}`}
            onClick={player.cycleRepeatMode}
            aria-label={REPEAT_LABEL[player.queue.repeat]}
            title={`${REPEAT_LABEL[player.queue.repeat]} (R)`}
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

      {/*
        Nine controls in a row read as one undifferentiated wall of icons. They
        are three separate jobs — what is on screen, how it plays, where it
        comes out — so they are three labelled groups with a hairline between.
      */}
      <div className="player-right">
        {player.stalled && <span className="spinner" aria-label="Buffering" />}

        <div className="player-group" role="group" aria-label="Panels">
          <button
            type="button"
            className={`icon-button ${page === 'focus' ? 'is-accent' : ''}`}
            onClick={onToggleLyrics}
            aria-label="Lyrics"
            aria-pressed={page === 'focus'}
            title="Lyrics, full size (L)"
          >
            <Mic size={17} />
          </button>

          <button
            type="button"
            className={`icon-button ${queueOpen ? 'is-accent' : ''}`}
            onClick={onOpenQueue}
            aria-label="Queue"
            aria-pressed={queueOpen}
            title="Up next (Q)"
          >
            <Queue size={17} />
          </button>

          <button
            type="button"
            className={`icon-button ${practiceOpen || player.loopB !== null ? 'is-accent' : ''}`}
            onClick={onOpenPractice}
            aria-label="Practice tools"
            aria-pressed={practiceOpen}
            title="Practice: A–B loop, speed, transpose (P)"
          >
            <Metronome size={17} />
          </button>
        </div>

        <div className="player-group" role="group" aria-label="Playback">
          <div className="popover-anchor">
            <button
              ref={speedRef}
              type="button"
              className={`icon-button ${player.rate !== 1 ? 'is-accent' : ''}`}
              onClick={() => setSpeedOpen(open => !open)}
              aria-label={`Playback speed: ${player.rate}×`}
              aria-haspopup="menu"
              aria-expanded={speedOpen}
              title={`Playback speed: ${player.rate}×`}
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
              title={player.sleepTimerEndsAt ? 'Sleep timer is running' : 'Sleep timer'}
            >
              <Moon size={17} />
            </button>
            {sleepOpen && <SleepMenu anchorRef={sleepRef} onClose={() => setSleepOpen(false)} />}
          </div>
        </div>

        <div className="player-group" role="group" aria-label="Output">
          <DevicesButton />
          <VolumeControl compact={compact} />
        </div>
      </div>
    </footer>
  )
}

/**
 * The line being sung, under the artist, while the page is closed.
 *
 * Only for songs whose lyrics are already known to be timed — it must never
 * be the reason a song gets looked up on lrclib. Shares its cache with the
 * page, so opening the page after this costs nothing.
 */
function LyricTicker({ song }: { song: Song }) {
  const transport = useTransport()
  const { data } = useQuery({
    queryKey: lyricsQueryKey(song.id),
    queryFn: () => api.lyrics(song.id),
    enabled: song.lyricsKind === 'synced',
    retry: false,
    staleTime: 10 * 60_000,
  })
  const parsed = useMemo(() => (data ? parseLyrics(data.text) : null), [data])
  if (!parsed?.synced) return null

  const index = activeLineIndex(parsed.lines, transport.currentTime)
  const text = parsed.lines[index]?.text.trim()
  if (!text) return null

  // Keyed by line, so each new line fades in rather than snapping.
  return (
    <span key={index} className="player-ticker">
      {text}
    </span>
  )
}

/**
 * Mute plus the slider.
 *
 * A window narrow enough to squeeze the track title down to two characters has
 * no room for 88px of slider, but dropping volume entirely is not an answer
 * either — so below the breakpoint the same two controls move into a popover
 * hanging off the speaker button.
 */
function VolumeControl({ compact }: { compact: boolean }) {
  const player = usePlayer()
  const transport = useTransport()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const muted = player.muted || transport.volume === 0
  const percent = Math.round(transport.volume * 100)
  const Icon = muted ? VolumeMute : Volume

  const slider = (
    <input
      className="volume"
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={transport.volume}
      style={{ '--progress': `${transport.volume * 100}%` } as React.CSSProperties}
      aria-label="Volume"
      aria-valuetext={`${percent}%`}
      onChange={event => transport.setVolume(Number(event.target.value))}
    />
  )

  const muteButton = (
    <button
      type="button"
      className="icon-button"
      onClick={player.toggleMute}
      aria-label={player.muted ? 'Unmute' : 'Mute'}
      aria-pressed={player.muted}
      title={player.muted ? 'Unmute' : 'Mute'}
      disabled={transport.remote !== null}
    >
      <Icon size={17} />
    </button>
  )

  if (!compact) {
    return (
      <>
        {muteButton}
        {slider}
      </>
    )
  }

  return (
    <div className="popover-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={`icon-button ${player.muted ? 'is-accent' : ''}`}
        onClick={() => setOpen(value => !value)}
        aria-label={`Volume: ${percent}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Volume: ${percent}%`}
      >
        <Icon size={17} />
      </button>
      {open && (
        <Popover
          anchorRef={buttonRef}
          onClose={() => setOpen(false)}
          role="dialog"
          placement="above"
          align="end"
          label="Volume"
          className="volume-popover"
        >
          <div className="volume-popover-row">
            {muteButton}
            {slider}
            <span className="volume-readout">{percent}%</span>
          </div>
        </Popover>
      )}
    </div>
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

/** Shared with the phone's now-playing sheet, so a sleep timer is set the same way everywhere. */
export function SleepMenu({
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
