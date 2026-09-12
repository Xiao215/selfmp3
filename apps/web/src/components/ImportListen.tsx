import { useEffect, useRef, useState } from 'react'
import { formatDuration, isYouTubeUrl, type ImportPreviewItem } from '@selfmp3/shared'
import { mediaUrl } from '../lib/api.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Pause, Play, X } from './Icons.js'

/**
 * Listening to a track on the review screen, before it is imported.
 *
 * The audio comes through the server (`/api/import/listen`), which asks
 * yt-dlp where it lives on YouTube; the first second or two of a track is
 * that lookup. It plays in an audio element of its own, not the player's, so
 * a preview never touches the queue. Whatever was playing pauses while you
 * listen and carries on when the preview is closed — unless you went back to
 * it yourself in the meantime, which the preview makes way for.
 */

type Track = Pick<ImportPreviewItem, 'url' | 'title' | 'artist' | 'duration'>

export type ListenStatus = 'loading' | 'playing' | 'paused' | 'error'

export interface Listening {
  readonly track: Track
  readonly status: ListenStatus
  readonly currentTime: number
  /** From the audio once it knows; the preview's length until then (0 if unknown). */
  readonly duration: number
}

/** The server can only stream what yt-dlp finds on YouTube. */
export const canListen = (item: Pick<ImportPreviewItem, 'url'>): boolean => isYouTubeUrl(item.url)

/**
 * Read from the element rather than from which event fired: switching tracks
 * fires the old one's `pause` after the new one has started loading.
 */
function statusOf(audio: HTMLAudioElement): ListenStatus {
  if (audio.error) return 'error'
  if (audio.paused) return 'paused'
  if (audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return 'loading'
  return 'playing'
}

const AUDIO_EVENTS = [
  'play',
  'playing',
  'pause',
  'waiting',
  'canplay',
  'seeking',
  'seeked',
  'timeupdate',
  'durationchange',
  'ended',
  'error',
] as const

export function useListen() {
  const player = usePlayer()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [listening, setListening] = useState<Listening | null>(null)
  /** Something was playing when previewing began; it carries on when the preview closes. */
  const resumeRef = useRef(false)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audioRef.current = audio

    const sync = (): void => {
      if (!audio.getAttribute('src')) return
      setListening(current =>
        current
          ? {
              ...current,
              status: statusOf(audio),
              currentTime: audio.currentTime,
              duration: Number.isFinite(audio.duration) ? audio.duration : current.duration,
            }
          : current,
      )
    }
    for (const name of AUDIO_EVENTS) audio.addEventListener(name, sync)

    return () => {
      for (const name of AUDIO_EVENTS) audio.removeEventListener(name, sync)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
  }, [])

  // Pressing play on the song itself ends the interlude.
  const wasPlaying = useRef(player.playing)
  useEffect(() => {
    if (player.playing && !wasPlaying.current) {
      audioRef.current?.pause()
      resumeRef.current = false
    }
    wasPlaying.current = player.playing
  }, [player.playing])

  const makeRoom = (): void => {
    if (!player.playing) return
    resumeRef.current = true
    player.pause()
  }

  /** Play a track, or pause and resume the one already loaded. */
  const toggle = (track: Track): void => {
    const audio = audioRef.current
    if (!audio) return

    if (listening?.track.url === track.url) {
      if (audio.paused || audio.error) {
        makeRoom()
        if (audio.error) audio.load()
        void audio.play().catch(() => undefined)
      } else {
        audio.pause()
      }
      return
    }

    makeRoom()
    setListening({ track, status: 'loading', currentTime: 0, duration: track.duration })
    audio.src = mediaUrl.importListen(track.url)
    // A refusal lands in the element's own error, which `sync` reads.
    void audio.play().catch(() => undefined)
  }

  const seek = (seconds: number): void => {
    const audio = audioRef.current
    if (!audio || !listening) return
    audio.currentTime = seconds
    setListening({ ...listening, currentTime: seconds })
  }

  const close = (): void => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setListening(null)
    if (resumeRef.current) {
      resumeRef.current = false
      player.play()
    }
  }

  return { listening, toggle, seek, close }
}

/** The play button in a review row, drawn over the track's thumbnail. */
export function ListenButton({
  item,
  listening,
  onToggle,
}: {
  item: ImportPreviewItem
  listening: Listening | null
  onToggle: () => void
}) {
  const status = listening?.track.url === item.url ? listening.status : null
  const label = status === 'playing' ? `Pause ${item.title}` : `Listen to ${item.title}`

  return (
    <button
      type="button"
      className={`import-thumb import-listen ${status ? `is-${status}` : ''}`}
      onClick={onToggle}
      aria-label={label}
      data-tip={status === 'playing' ? 'Pause' : 'Listen before importing'}
    >
      {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
      <span className="import-listen-icon" aria-hidden="true">
        {status === 'loading' ? (
          <span className="spinner spinner-tiny" />
        ) : status === 'playing' ? (
          <Pause size={14} />
        ) : (
          <Play size={14} />
        )}
      </span>
    </button>
  )
}

/** What is being previewed, with a playhead to drag anywhere in it. */
export function ListenBar({
  listening,
  onToggle,
  onSeek,
  onClose,
}: {
  listening: Listening
  onToggle: () => void
  onSeek: (seconds: number) => void
  onClose: () => void
}) {
  // While dragging, the handle shows where it is going, not where the audio is.
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const { track, status, duration } = listening
  const time = scrubbing ?? listening.currentTime
  const percent = duration > 0 ? (Math.min(time, duration) / duration) * 100 : 0

  const commit = (): void => {
    if (scrubbing !== null) onSeek(scrubbing)
    setScrubbing(null)
  }

  return (
    <div className="listen-bar" role="region" aria-label="Listening before import">
      <button
        type="button"
        className="icon-button listen-toggle"
        onClick={onToggle}
        aria-label={status === 'playing' ? 'Pause' : 'Play'}
      >
        {status === 'loading' ? (
          <span className="spinner spinner-tiny" aria-hidden="true" />
        ) : status === 'playing' ? (
          <Pause size={16} />
        ) : (
          <Play size={16} />
        )}
      </button>

      <div className="listen-meta">
        <span className="listen-title">{track.title || 'Untitled'}</span>
        <span className={`listen-artist ${status === 'error' ? 'is-error' : ''}`}>
          {status === 'error'
            ? 'Couldn’t play this one from YouTube'
            : track.artist || 'Unknown artist'}
        </span>
      </div>

      <div className="listen-progress">
        <span className="time">{formatDuration(time)}</span>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(time, duration || 1)}
          style={{ '--progress': `${percent}%` } as React.CSSProperties}
          disabled={duration <= 0}
          aria-label="Position in the song"
          aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
          onChange={event => setScrubbing(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        <span className="time">{duration > 0 ? formatDuration(duration) : '–:––'}</span>
      </div>

      <button
        type="button"
        className="icon-button"
        onClick={onClose}
        aria-label="Stop listening"
        data-tip="Stop listening"
      >
        <X size={15} />
      </button>
    </div>
  )
}
