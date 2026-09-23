import TrackPlayer, { Event } from 'react-native-track-player'

import { sendRemoteCommand } from './remoteCommands'

/**
 * The playback service.
 *
 * react-native-track-player runs this outside the React tree — on Android it
 * is a headless task that keeps running when every screen is gone — so it must
 * not touch component state. Its only job is to turn remote control events
 * (lock screen, headphones, steering wheel, CarPlay transport, Android Auto)
 * into player calls.
 *
 * Events that need library knowledge (`RemotePlayId`, `RemotePlaySearch` from
 * Android Auto) are handled in `src/ports/car/androidAuto.ts` instead, where the
 * library is in scope.
 */
/**
 * Whether this JavaScript context has already wired the handlers up.
 *
 * `registerPlaybackService` is called from the layout's module body, and Fast
 * Refresh re-runs module bodies — so every reload in development stacked
 * another full set of handlers on the same events, and one tap of the lock
 * screen's Next skipped as many tracks as there had been reloads. A fresh
 * context (a cold start, or Android's headless task) starts false again, which
 * is exactly right: those genuinely do need wiring up.
 */
let registered = false

export async function playbackService(): Promise<void> {
  if (registered) return
  registered = true

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play()
  })

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause()
  })

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    // Stop, not reset: the queue survives so the notification's play button
    // starts the same track again rather than silence.
    void TrackPlayer.stop()
  })

  // Through the app's queue while it is there (see remoteCommands.ts).
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    if (!sendRemoteCommand('next')) void TrackPlayer.skipToNext()
  })

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    if (!sendRemoteCommand('previous')) void TrackPlayer.skipToPrevious()
  })

  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
    void TrackPlayer.seekTo(position)
  })

  TrackPlayer.addEventListener(Event.RemoteJumpForward, ({ interval }) => {
    void TrackPlayer.seekBy(interval)
  })

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, ({ interval }) => {
    void TrackPlayer.seekBy(-interval)
  })

  TrackPlayer.addEventListener(Event.RemoteDuck, ({ paused, permanent }) => {
    // A phone call or a navigation prompt. Permanent means the audio focus is
    // gone for good, so pause rather than wait for a resume that never comes.
    void (permanent || paused ? TrackPlayer.pause() : TrackPlayer.play())
  })
}
