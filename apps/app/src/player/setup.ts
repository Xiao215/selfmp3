import TrackPlayer, {
  AndroidAudioContentType,
  AppKilledPlaybackBehavior,
  Capability,
  IOSCategory,
  IOSCategoryMode,
} from 'react-native-track-player'

/**
 * One-time player setup.
 *
 * `setupPlayer` throws if it is called twice, and on Android it throws if the
 * app is in the background, so the result is cached and the caller is expected
 * to await this before touching the player.
 */

let setupPromise: Promise<void> | null = null

export function ensurePlayer(): Promise<void> {
  setupPromise ??= setup().catch(error => {
    // Let the next attempt try again rather than caching a failure forever —
    // the common cause is "called while backgrounded", which fixes itself.
    setupPromise = null
    throw error
  })
  return setupPromise
}

async function setup(): Promise<void> {
  await TrackPlayer.setupPlayer({
    // Playback + lock-screen controls. `autoHandleInterruptions` lets the
    // native side pause for a phone call without a round trip through JS.
    iosCategory: IOSCategory.Playback,
    iosCategoryMode: IOSCategoryMode.Default,
    androidAudioContentType: AndroidAudioContentType.Music,
    autoHandleInterruptions: true,
  })

  await TrackPlayer.updateOptions({
    android: {
      // Music should keep playing when the app is swiped away; that is the
      // difference between a music app and a toy.
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
    },
    // PlayFromId and PlayFromSearch are what let Android Auto and Google
    // Assistant ask for something by name.
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.Stop,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.PlayFromId,
      Capability.PlayFromSearch,
    ],
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
    ],
    progressUpdateEventInterval: 1,
  })
}
