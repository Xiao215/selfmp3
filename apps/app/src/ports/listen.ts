import {
  clearPreloadedSource,
  createAudioPlayer,
  preload,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio'
import { AppState } from 'react-native'
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
/**
 * How long a stream may stay silent after play is asked before it counts as
 * failed. The server may hold a preview up to thirty seconds while it paces
 * its requests to YouTube; a stream that has said nothing after this has
 * gone wrong in a way the player does not always report — a refused address
 * left one spinning for good.
 */
const SILENT_MS = 45_000

/**
 * What the preview is doing, read from the player's report and from what was
 * last asked of it. A player told to play reports `playing` while it is still
 * waiting on the network, so the wait is read as loading until it is not
 * waiting; a player told to pause is paused whatever its buffer is doing.
 */
function statusOf(status: AudioStatus, asked: 'play' | 'pause'): ListenStatus {
  if (status.playbackState === 'failed') return 'error'
  if (asked === 'pause') return 'paused'
  const waiting = status.isBuffering || status.timeControlStatus === 'waitingToPlayAtSpecifiedRate'
  return status.isLoaded && status.playing && !waiting ? 'playing' : 'loading'
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
  /** Runs out when a stream asked to play has said nothing for `SILENT_MS`. */
  let silence: ReturnType<typeof setTimeout> | null = null
  /** Where a preview let go in the background starts again, in seconds. */
  let startAt = 0
  /** The song's length as last reported, kept for a preview with no player. */
  let length = NaN

  const tell = (state: ListenState): void => {
    for (const listener of listeners) listener(state)
  }

  const clearSilence = (): void => {
    if (silence !== null) clearTimeout(silence)
    silence = null
  }
  const watchSilence = (uri: string): void => {
    clearSilence()
    silence = setTimeout(() => {
      silence = null
      if (src !== uri || asked !== 'play') return
      console.warn('preview said nothing for too long', uri)
      player?.pause()
      tell({ status: 'error', currentTime: 0, duration: NaN })
    }, SILENT_MS)
  }

  const report = (status: AudioStatus): void => {
    if (src === null) return
    // The end of the song is a pause the player made for itself.
    if (status.didJustFinish) asked = 'pause'
    const state = statusOf(status, asked)
    if (state !== 'loading') clearSilence()
    if (status.duration > 0) length = status.duration
    tell({ status: state, currentTime: status.currentTime, duration: length })
  }

  const letGo = (): void => {
    subscription?.remove()
    subscription = null
    player?.remove()
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
        clearSilence()
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
    clearSilence()
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
      watchSilence(uri)
      open(uri)
    },
    resume: () => {
      if (src === null) return
      asked = 'play'
      watchSilence(src)
      // A player that failed does not recover, and one let go in the
      // background is gone; either is opened afresh, where it was.
      if (!player || player.currentStatus.playbackState === 'failed') open(src, startAt)
      else player.play()
    },
    pause: () => {
      asked = 'pause'
      clearSilence()
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
    // Letting go is a pause with nothing more to report; a stream still
    // opening for this preview is let go when it arrives.
    stop: () => {
      asked = 'pause'
      src = null
      opening++
      clearSilence()
      player?.pause()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      backgrounded.remove()
      opening++
      src = null
      clearSilence()
      listeners.clear()
      letGo()
    },
  }
}
