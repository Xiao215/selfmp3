import { Platform } from 'react-native'
import TrackPlayer, { Event } from 'react-native-track-player'
import { resolveMediaId, searchBrowseTree, type BrowseTree } from './browseTree'

/**
 * Android Auto.
 *
 * What is actually available today, having read the package rather than the
 * marketing:
 *
 *   - react-native-track-player 5's `MusicService` is a media3
 *     `MediaLibraryService` and its manifest declares both
 *     `androidx.media3.session.MediaLibraryService` and
 *     `android.media.browse.MediaBrowserService`. Android Auto therefore sees
 *     the app, shows it in the launcher, and drives it with the standard
 *     transport controls, artwork and metadata from the current queue.
 *   - There is **no** JavaScript API to publish a browse tree. `setBrowseTree`
 *     exists in a stale build artifact inside the 5.0.0-alpha0 tarball
 *     (`lib/src/`), but it is not in the package's `exports`, not in the
 *     TurboModule spec (`src/NativeTrackPlayer.ts`) and not in any nightly
 *     since. Calling it would be calling a method that does not exist.
 *
 * So the browsable hierarchy in the car's own menu is the one thing that
 * cannot be wired up yet. What *is* wired up here are the two entry points
 * Android Auto and the Assistant use, both of which RNTP does expose:
 *
 *   - `RemotePlayId` — "play this media id", used when the car has an id from
 *     a previous session or from a voice result.
 *   - `RemotePlaySearch` — "play Kind of Blue", the voice search path.
 *
 * Both are resolved against exactly the same `BrowseTree` CarPlay browses, so
 * when RNTP does ship a browse-tree API the tree is already built and tested
 * and only the publishing call is missing. See docs/MOBILE.md for the
 * alternatives (a patched fork, or a small native MediaLibraryService).
 */

export interface AndroidAutoHandlers {
  readonly onPlay: (songIds: readonly number[], startIndex: number) => void
}

export function connectAndroidAuto(
  getTree: () => BrowseTree,
  handlers: AndroidAutoHandlers,
): () => void {
  if (Platform.OS !== 'android') return () => undefined

  const subscriptions = [
    TrackPlayer.addEventListener(Event.RemotePlayId, ({ id }) => {
      const selection = resolveMediaId(getTree(), id)
      if (selection?.kind === 'play') handlers.onPlay(selection.songIds, selection.startIndex)
    }),

    TrackPlayer.addEventListener(Event.RemotePlaySearch, event => {
      // The car sends a raw query plus, sometimes, a parsed focus. The parsed
      // fields are more precise when present, so they are tried first.
      const query = event.playlist ?? event.album ?? event.artist ?? event.title ?? event.query
      const selection = searchBrowseTree(getTree(), query ?? '')
      if (selection?.kind === 'play') handlers.onPlay(selection.songIds, selection.startIndex)
    }),
  ]

  return () => {
    for (const subscription of subscriptions) subscription.remove()
  }
}
