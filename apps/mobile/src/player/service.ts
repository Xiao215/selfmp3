import TrackPlayer, { Event } from 'react-native-track-player'

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
 * Android Auto) are handled in `src/car/androidAuto.ts` instead, where the
 * library is in scope.
 */
export async function playbackService(): Promise<void> {
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

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void TrackPlayer.skipToNext()
  })

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void TrackPlayer.skipToPrevious()
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

  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }) => {
    // A phone call or a navigation prompt. Permanent means the audio focus is
    // gone for good, so pause rather than wait for a resume that never comes.
    if (permanent || paused) await TrackPlayer.pause()
    else await TrackPlayer.play()
  })
}
