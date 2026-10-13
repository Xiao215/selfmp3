import {
  clearPreloadedSource,
  createAudioPlayer,
  preload,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio'
import { AppState } from 'react-native'
import { createSilenceWatch, previewStatus } from '../features/import/listen.model'
import type { ListenAudio, ListenState, ListenStatus } from './listen.types'

/**
 * Listening before importing, on a phone.
 *
 * The phone's player is track-player, which has one queue, and a preview is
 * not a song in it. expo-audio plays the preview in a player of its own, apart
 * from the queue, as the web's audio element does (listen.web.ts). The server
 * answers `/api/import/listen` by asking yt-dlp where the track lives on
 * YouTube, so the first second or two is that lookup; the token rides in the
 * address, so the player is handed a plain link.
 *
 * A link is not handed to a player straight away. Giving a player its source
 * is a call that holds the JavaScript thread until the stream has answered —
 * those two seconds, the first time a song is asked for — and the whole app
 * stood still for them, the row not even opening. `preload` opens the stream
 * off the thread first, and a new player then takes the opened stream in one
 * quick call and starts. A player per preview, then, since only a new player
 * can take a preloaded stream.
 *
 * The audio session is track-player's. expo-audio would deactivate it when a
 * preview pauses or ends, a hundred milliseconds after — under a song this
 * preview had paused and `close` has just started again — so each player is
 * made to leave it be (`keepAudioSessionActive`).
 *
 * The session's category, though, is asked for here as well. Track-player
 * only sets its Playback category once a song is loaded to play, and a
 * review opened before any song has played that launch found the session in
 * iOS's default: ambient, which the Ring/Silent switch mutes on the speaker
 * and not on AirPods — a preview heard through one and not the other. The
 * mode asked for below is the same category track-player sets (Playback, not
 * mixing), so whichever of the two asks first, the other finds it already so.
 */
export const canListenHere = true

/**
 * How much of a preview the player gathers before it starts, in seconds.
 *
 * Left to itself, AVPlayer buffers as much as it thinks a stall-free play
 * needs, and over a tunnel it thinks a great deal: the tap-to-sound wait was
 * that, more than the lookup. A preview is a listen, not a performance; a
 * couple of seconds in hand is enough to start on.
 */
const PREVIEW_BUFFER_S = 2

/** How often the player says where it is: the bar moves four times a second. */
const TICK_MS = 250

/** What the preview is doing, by the rule both twins read (`previewStatus`). */
function statusOf(status: AudioStatus, asked: 'play' | 'pause', silent: boolean): ListenStatus {
  const waiting = status.isBuffering || status.timeControlStatus === 'waitingToPlayAtSpecifiedRate'
  return previewStatus(asked, {
    failed: silent || status.playbackState === 'failed',
    ready: status.isLoaded && status.playing && !waiting,
  })
}

export function createListenAudio(): ListenAudio | null {
  // Fire and forget: a refusal leaves the category as it was, which is the
  // one this was to make sure of when a song has already played.
  setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    allowsRecording: false,
    shouldPlayInBackground: false,
  }).catch(() => undefined)

  const listeners = new Set<(state: ListenState) => void>()
  let player: AudioPlayer | null = null
  let subscription: { remove(): void } | null = null
  /** The link last handed over, for trying again after an error; null between previews. */
  let src: string | null = null
  let asked: 'play' | 'pause' = 'pause'
  /** Which `play` the stream being opened is for; one opened for an earlier play is let go. */
  let opening = 0
  /** Set when a stream asked to play said nothing for too long; cleared by the next play. */
  let silent = false
  /** Where a preview let go in the background starts again, in seconds. */
  let startAt = 0
  /** The song's length as last reported, kept for a preview with no player. */
  let length = NaN

  const tell = (state: ListenState): void => {
    for (const listener of listeners) listener(state)
  }

  const silence = createSilenceWatch(() => {
    if (src === null || asked !== 'play') return
    console.warn('preview said nothing for too long', src)
    silent = true
    player?.pause()
    tell({ status: 'error', currentTime: 0, duration: NaN })
  })
  const watchSilence = (): void => {
    silent = false
    silence.watch()
  }

  const report = (status: AudioStatus): void => {
    if (src === null) return
    // The end of the song is a pause the player made for itself.
    if (status.didJustFinish) asked = 'pause'
    const state = statusOf(status, asked, silent)
    silence.heard(state)
    if (status.duration > 0) length = status.duration
    tell({ status: state, currentTime: status.currentTime, duration: length })
  }

  /*
   * A player let go is silenced first. expo-audio's `remove` only takes the
   * player off the module's list; the AVPlayer under it plays on until the
   * object is released, which `release` asks for now rather than whenever
   * the garbage collector gets to it. Leaving the import page played the
   * preview on over the rest of the app, and so did locking the phone when
   * this ran before expo-audio's own pause.
   */
  const letGo = (): void => {
    subscription?.remove()
    subscription = null
    if (player) {
      player.pause()
      player.remove()
      player.release()
    }
    player = null
  }

  /** Open the stream off the thread, then play it in a player of its own, from `from` seconds. */
  const open = (uri: string, from = 0): void => {
    const mine = ++opening
    preload({ uri }, { preferredForwardBufferDuration: PREVIEW_BUFFER_S })
      .then(() => {
        if (mine !== opening || src !== uri) {
          void clearPreloadedSource({ uri })
          return
        }
        letGo()
        const next = createAudioPlayer(
          { uri },
          {
            updateInterval: TICK_MS,
            keepAudioSessionActive: true,
            preferredForwardBufferDuration: PREVIEW_BUFFER_S,
          },
        )
        subscription = next.addListener('playbackStatusUpdate', report)
        player = next
        if (from > 0) void next.seekTo(from)
        if (asked === 'play') next.play()
      })
      // Whatever failed — the stream, the player, the audio session refusing
      // to start — is a preview that will not play, and the row says so
      // rather than showing the wait for ever.
      .catch((error: unknown) => {
        console.warn('preview could not start', error)
        if (mine !== opening || src !== uri) return
        silence.stop()
        tell({ status: 'error', currentTime: 0, duration: NaN })
      })
  }

  /*
   * A preview stops when the app goes to the background. The lock screen and
   * the Dynamic Island are track-player's, so they showed the library's song,
   * the one the preview had paused, as playing over a preview you could no
   * longer see or stop. Back in the app the card is where it was, paused.
   *
   * Stops, not pauses: its player is let go, and play opens the stream again
   * where it was (`startAt`). expo-audio pauses every playing player itself
   * as the app leaves, and plays each of them again as it comes back
   * (`shouldPlayInBackground` false, AudioModule.swift) — under a card this
   * had said was paused, so the song played on with ▶ showing, and ▶ then
   * changed the icon and not the sound. A player that is gone is not played
   * again by anyone.
   */
  const backgrounded = AppState.addEventListener('change', state => {
    if (state !== 'background' || src === null || asked !== 'play') return
    asked = 'pause'
    silence.stop()
    // A stream still opening for this preview is let go when it arrives.
    opening++
    startAt = player?.currentTime ?? startAt
    letGo()
    tell({ status: 'paused', currentTime: startAt, duration: length })
  })

  return {
    play: uri => {
      src = uri
      asked = 'play'
      startAt = 0
      length = NaN
      player?.pause()
      watchSilence()
      open(uri)
    },
    resume: () => {
      if (src === null) return
      asked = 'play'
      watchSilence()
      // A player that failed does not recover, and one let go in the
      // background is gone; either is opened afresh, where it was.
      if (!player || player.currentStatus.playbackState === 'failed') open(src, startAt)
      else player.play()
    },
    pause: () => {
      asked = 'pause'
      silence.stop()
      player?.pause()
    },
    seek: seconds => {
      if (player) {
        void player.seekTo(seconds)
        return
      }
      // With its player let go, the place is kept for play to start from.
      if (src === null) return
      startAt = seconds
      tell({ status: 'paused', currentTime: seconds, duration: length })
    },
    // A stopped preview's player is gone, so nothing — expo-audio coming
    // back from the background included — can play it again; a stream still
    // opening for this preview is let go when it arrives.
    stop: () => {
      asked = 'pause'
      src = null
      opening++
      silence.stop()
      letGo()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      backgrounded.remove()
      opening++
      src = null
      silence.stop()
      listeners.clear()
      letGo()
    },
  }
}
