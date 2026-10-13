import { createSilenceWatch, previewStatus } from '../features/import/listen.model'
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
 * fires the old one's `pause` after the new one has started loading. Whether
 * it is paused is what was last asked of it; the rest is `previewStatus`'s.
 */
function statusOf(audio: HTMLAudioElement, silent: boolean): ListenStatus {
  return previewStatus(audio.paused ? 'pause' : 'play', {
    failed: silent || audio.error !== null,
    ready: !audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
  })
}

export function createListenAudio(): ListenAudio | null {
  const audio = new Audio()
  audio.preload = 'auto'
  const listeners = new Set<(state: ListenState) => void>()
  /** Set when the element, asked to play, said nothing for too long; cleared by the next play. */
  let silent = false

  const sync = (): void => {
    if (!audio.getAttribute('src')) return
    const state = {
      status: statusOf(audio, silent),
      currentTime: audio.currentTime,
      duration: audio.duration,
    }
    silence.heard(state.status)
    for (const listener of listeners) listener(state)
  }
  for (const name of EVENTS) audio.addEventListener(name, sync)

  // A request the browser left hanging says nothing at all: no error, no
  // `canplay`, a spinner for good.
  const silence = createSilenceWatch(() => {
    if (!audio.getAttribute('src') || audio.paused) return
    console.warn('preview said nothing for too long', audio.src)
    silent = true
    audio.pause()
    sync()
  })
  const playFromHere = (): void => {
    silent = false
    silence.watch()
    // A refusal lands in the element's own error, which `sync` reads.
    void audio.play().catch(() => undefined)
  }

  const stop = (): void => {
    silence.stop()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  return {
    play: src => {
      audio.src = src
      playFromHere()
    },
    resume: () => {
      if (audio.error || silent) audio.load()
      playFromHere()
    },
    pause: () => {
      silence.stop()
      audio.pause()
    },
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
