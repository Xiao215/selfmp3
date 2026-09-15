import type { ListenAudio, ListenState, ListenStatus } from './listen.types'

/**
 * Listening before importing, in a browser.
 *
 * An audio element of its own, not the player's, so a preview never touches
 * the queue. The server answers `/api/import/listen` by asking yt-dlp where the
 * track lives on YouTube, so the first second or two is that lookup.
 */
export const canListenHere = true

const EVENTS = [
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

export function createListenAudio(): ListenAudio | null {
  const audio = new Audio()
  audio.preload = 'auto'
  const listeners = new Set<(state: ListenState) => void>()

  const sync = (): void => {
    if (!audio.getAttribute('src')) return
    const state = { status: statusOf(audio), currentTime: audio.currentTime, duration: audio.duration }
    for (const listener of listeners) listener(state)
  }
  for (const name of EVENTS) audio.addEventListener(name, sync)

  const stop = (): void => {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  return {
    play: src => {
      audio.src = src
      // A refusal lands in the element's own error, which `sync` reads.
      void audio.play().catch(() => undefined)
    },
    resume: () => {
      if (audio.error) audio.load()
      void audio.play().catch(() => undefined)
    },
    pause: () => audio.pause(),
    seek: seconds => {
      audio.currentTime = seconds
    },
    stop,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      for (const name of EVENTS) audio.removeEventListener(name, sync)
      listeners.clear()
      stop()
    },
  }
}
