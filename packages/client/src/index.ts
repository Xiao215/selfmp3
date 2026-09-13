/**
 * `@selfmp3/client` — what any client of this library does that is not drawing.
 *
 * The API client, the query hooks and the rules about which server answers,
 * compiled without the DOM so the same code runs in a browser, on a phone and
 * in a test. Everything platform-shaped is an interface in `platform.ts`.
 */
export type {
  ApiContext,
  ApiTransport,
  ClientFetch,
  ClientPlatform,
  ClientRequestInit,
  ClientResponse,
  CloudRequest,
  LibrarySnapshotStore,
  OutboxStore,
} from './platform.js'

export { ApiError } from './api/error.js'
export { createApi, type Api, type ApiOptions } from './api/api.js'
export { createMediaUrl, type MediaUrl } from './api/media.js'

export {
  normaliseBaseUrl,
  serverTransport,
  type ServerConnection,
} from './connection/connection.js'

export { configureClient, clientApi, librarySnapshot, type ClientRuntime } from './runtime.js'

export { ClientStateProvider, useClientState, type ClientState } from './queries/context.js'
export * from './queries/queries.js'

export * from './downloads/downloadIndex.js'
export * from './downloads/syncPolicy.js'
export * from './queue/playable.js'

/** Filtering and sorting a library, which every client does the same way. */
export * from './library/filter.js'

/** Presence and handoff: pure rules, shared by every client. */
export * from './devices/handoff.js'

export { createListenOutbox, type ListenOutbox } from './listens/outbox.js'

/** The colours a cover lends Now Playing. */
export * from './art/palette.js'

export * from './theme/oklch.js'
export * from './theme/tokens.js'

export * from './listens/counting.js'

export type {
  EngineCapabilities,
  EngineState,
  EngineWiring,
  FrequencyAnalyser,
  LoadOptions,
  PlaybackEngine,
  TrackMetadata,
} from './ports/engine.js'
export type { DownloadFraction, OfflineStore, SaveOptions, StorageUsage } from './ports/offline.js'
export type { ServerEventStream } from './ports/events.js'
export { DownloadQueue, type DownloadQueueState } from './downloads/queue.js'
export type { DownloadStorage, DownloadTransfer, TransferProgress } from './ports/offline.js'
export {
  EMPTY_SELECTION,
  allSelected,
  clearSelection,
  clickSelected,
  deselectAll,
  enterSelection,
  pruneSelection,
  selectAllVisible,
  selectionActive,
  toggleSelected,
  type ClickResult,
  type SelectionModifiers,
  type SelectionState,
} from './selection/selection.js'

export * from './songs/facts.js'
