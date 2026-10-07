import TrackPlayer from 'react-native-track-player'

import { playbackService } from './service'

/**
 * Hand track-player the playback service (`service.ts`).
 *
 * Called at module scope by the app's layout, before any component mounts: on
 * Android the service is a headless task the OS may start with no UI at all,
 * so registration cannot wait for React.
 *
 * The phone's alone. A browser plays through `ports/engine.web.ts` and has no
 * track-player to register with (`registerPlayback.web.ts`).
 */
export function registerPlayback(): void {
  TrackPlayer.registerPlaybackService(() => playbackService)
}
