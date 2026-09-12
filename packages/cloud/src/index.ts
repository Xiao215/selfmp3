/**
 * A device's own copy of the cloud library (docs/SYNC.md).
 *
 * Every device — the Mac, a browser, the phone — keeps the whole library's
 * metadata and replays other devices' changes onto it. The rules for doing
 * that are the same everywhere, so they live here rather than inside whichever
 * app happened to need them first, which was the web one.
 *
 * **There is no platform in this package, and the compiler enforces it**: its
 * `tsconfig.json` omits the `DOM` library, so a reach for `window`, `caches`
 * or `localStorage` fails to build rather than failing on a phone. Storing
 * things and fetching things are the platform's business; this package says
 * what to store and what to ask for.
 */

export { CloudRouteError, notFound } from './errors.js'
export * as edits from './edits.js'
export type { EditContext } from './edits.js'
export { foldedOwnLogs, latestStamp, replay, replayedSnapshot } from './replay.js'
export {
  CloudImportRequestSchema,
  ImportRequestListSchema,
  ImportRequestViewSchema,
  type CloudImportRequest,
  type ImportRequestList,
  type ImportRequestView,
} from './schemas.js'
export {
  NO_IDS,
  snapshotToLibrary,
  type CloudLibrary,
  type LocalIds,
  type SongFiles,
} from './snapshotLibrary.js'

export type {
  CloudFetch,
  CloudPlatform,
  CloudRequestInit,
  CloudResponse,
  DeviceStore,
} from './platform.js'
export {
  DoormanError,
  SESSION_KEY,
  createCloudSession,
  type ClaimOutcome,
  type CloudSession,
  type CloudSessionApi,
  type PendingSignIn,
} from './session.js'
export type { TextCache } from './platform.js'
export {
  FILES_KEY,
  createCloudLibrary,
  type CloudLibraryApi,
} from './library.js'
export { createCloudRoutes, parseQuery, type RouteQuery } from './routes.js'
