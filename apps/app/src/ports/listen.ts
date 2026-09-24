import {
  clearPreloadedSource,
  createAudioPlayer,
  preload,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio'
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
 * made to leave it be (`keepAudioSessionActive`), and no audio mode is set
 * here: the category track-player chose stands.
 */
export const canListenHere = true

/** How often the player says where it is: the bar moves four times a second. */
const TICK_MS = 250

/**
 * What the preview is doing, read from the player's report and from what was
 * last asked of it. A player told to play reports `playing` while it is still
 * waiting on the network, so the wait is read as loading until it is not
 * waiting; a player told to pause is paused whatever its buffer is doing.
 */
export function statusOf(status: AudioStatus, asked: 'play' | 'pause'): ListenStatus {
  if (status.playbackState === 'failed') return 'error'
  if (asked === 'pause') return 'paused'
  const waiting = status.isBuffering || status.timeControlStatus === 'waitingToPlayAtSpecifiedRate'
  return status.isLoaded && status.playing && !waiting ? 'playing' : 'loading'
}

export function createListenAudio(): ListenAudio | null {
  const listeners = new Set<(state: ListenState) => void>()
  let player: AudioPlayer | null = null
  let subscription: { remove(): void } | null = null
  /** The link last handed over, for trying again after an error; null between previews. */
  let src: string | null = null
  let asked: 'play' | 'pause' = 'pause'
  /** Which `play` the stream being opened is for; one opened for an earlier play is let go. */
  let opening = 0

  const tell = (state: ListenState): void => {
    for (const listener of listeners) listener(state)
  }

  const report = (status: AudioStatus): void => {
    if (src === null) return
    // The end of the song is a pause the player made for itself.
    if (status.didJustFinish) asked = 'pause'
    tell({
      status: statusOf(status, asked),
      currentTime: status.currentTime,
      duration: status.duration > 0 ? status.duration : NaN,
    })
  }

  const letGo = (): void => {
    subscription?.remove()
    subscription = null
    player?.remove()
    player = null
  }

  /** Open the stream off the thread, then play it in a player of its own. */
  const open = (uri: string): void => {
    const mine = ++opening
    preload({ uri }).then(
      () => {
        if (mine !== opening || src !== uri) {
          void clearPreloadedSource({ uri })
          return
        }
        letGo()
        const next = createAudioPlayer(
          { uri },
          { updateInterval: TICK_MS, keepAudioSessionActive: true },
        )
        subscription = next.addListener('playbackStatusUpdate', report)
        player = next
        if (asked === 'play') next.play()
      },
      () => {
        if (mine === opening && src === uri)
          tell({ status: 'error', currentTime: 0, duration: NaN })
      },
    )
  }

  return {
    play: uri => {
      src = uri
      asked = 'play'
      player?.pause()
      open(uri)
    },
    resume: () => {
      if (src === null) return
      asked = 'play'
      // A player that failed does not recover; its stream is opened afresh.
      if (!player || player.currentStatus.playbackState === 'failed') open(src)
      else player.play()
    },
    pause: () => {
      asked = 'pause'
      player?.pause()
    },
    seek: seconds => {
      void player?.seekTo(seconds)
    },
    // Letting go is a pause with nothing more to report; a stream still
    // opening for this preview is let go when it arrives.
    stop: () => {
      asked = 'pause'
      src = null
      opening++
      player?.pause()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      opening++
      src = null
      listeners.clear()
      letGo()
    },
  }
}
