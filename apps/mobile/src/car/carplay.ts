import { Platform } from 'react-native'
import type { ListTemplate as ListTemplateType } from 'react-native-carplay'
import { nodeById, ROOT_ID, type BrowseNode, type BrowseTree } from './browseTree'

/**
 * CarPlay: a stack of list templates over the browse tree, plus the system
 * Now Playing screen.
 *
 * Everything here is behind `isCarPlayAvailable()`. On Android the native
 * module does not exist and the package's singleton throws while constructing,
 * so it is `require`d lazily rather than imported at the top of the file — an
 * import would take the whole app down on a phone that has never seen a car.
 */

type CarPlayModule = typeof import('react-native-carplay')

let cached: CarPlayModule | null | undefined

function carPlayModule(): CarPlayModule | null {
  if (cached !== undefined) return cached
  if (Platform.OS !== 'ios') {
    cached = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-carplay') as CarPlayModule
  } catch {
    // The app was built without the CarPlay pod — still a working music app.
    cached = null
  }
  return cached
}

export function isCarPlayAvailable(): boolean {
  return carPlayModule() !== null
}

export interface CarPlayHandlers {
  /** Start playback of a list, from a position within it. */
  readonly onPlay: (songIds: readonly number[], startIndex: number) => void
  /** Cover art URL for a song, or null when there is none. */
  readonly artworkUrl: (songId: number) => string | null
}

/**
 * Attach to CarPlay.
 *
 * Returns a disposer. Safe to call when no car is connected and on Android,
 * where it does nothing at all.
 */
export function connectCarPlay(
  getTree: () => BrowseTree,
  handlers: CarPlayHandlers,
): () => void {
  const module = carPlayModule()
  if (!module) return () => undefined

  const { CarPlay } = module

  const showRoot = (): void => {
    const root = nodeById(getTree(), ROOT_ID)
    if (!root) return
    CarPlay.setRootTemplate(buildListTemplate(module, root, getTree, handlers), false)
    // The system Now Playing template — transport controls, artwork and the
    // scrubber — comes free once enabled, so there is no reason to build one.
    CarPlay.enableNowPlaying(true)
  }

  if (CarPlay.connected) showRoot()
  CarPlay.registerOnConnect(showRoot)

  const onDisconnect = (): void => undefined
  CarPlay.registerOnDisconnect(onDisconnect)

  return () => {
    CarPlay.unregisterOnConnect(showRoot)
    CarPlay.unregisterOnDisconnect(onDisconnect)
  }
}

/**
 * One node → one CPListTemplate.
 *
 * Selecting a browsable row pushes the child list; selecting a song starts the
 * whole list from that song and jumps to Now Playing, which is the behaviour a
 * driver expects and the only interaction that is legal to require at speed.
 */
function buildListTemplate(
  module: CarPlayModule,
  node: BrowseNode,
  getTree: () => BrowseTree,
  handlers: CarPlayHandlers,
): ListTemplateType {
  const { CarPlay, ListTemplate, NowPlayingTemplate } = module

  return new ListTemplate({
    id: node.id,
    title: node.title,
    sections: [
      {
        items: node.items.map(item => {
          const artwork = item.artSongId === null ? null : handlers.artworkUrl(item.artSongId)
          return {
            id: item.id,
            text: item.title,
            detailText: item.subtitle,
            showsDisclosureIndicator: item.browsable,
            // A remote URI is fine here: CarPlay loads and caches it itself,
            // and the token is already in the query string.
            ...(artwork === null ? {} : { image: { uri: artwork } }),
          }
        }),
      },
    ],
    onItemSelect: async ({ index }) => {
      const item = node.items[index]
      if (!item) return

      if (item.browsable) {
        const child = nodeById(getTree(), item.id)
        if (child) CarPlay.pushTemplate(buildListTemplate(module, child, getTree, handlers), true)
        return
      }

      handlers.onPlay(node.songIds, index)
      CarPlay.pushTemplate(new NowPlayingTemplate({}), true)
    },
  })
}
