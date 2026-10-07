/**
 * A device's own copy of the cloud library (docs/SYNC.md).
 *
 * Every device — the server, a browser, the phone — keeps the whole library's
 * metadata and replays other devices' changes onto it. The rules for doing
 * that are the same everywhere, so they live here rather than inside any one
 * app.
 *
 * **There is no platform in this package, and the compiler enforces it**: its
 * `tsconfig.json` omits the `DOM` library, so a reach for `window`, `caches`
 * or `localStorage` fails to build rather than failing on a phone. Storing
 * things and fetching things are the platform's business; this package says
 * what to store and what to ask for.
 */

export { CloudRouteError } from './errors.js'
export {
  CloudServerViewSchema,
  ImportRequestListSchema,
  ImportRequestViewSchema,
  type CloudImportRequest,
  type ImportRequestList,
  type ImportRequestView,
} from './schemas.js'
export type { CloudPlatform, DeviceStore, TextCache } from './platform.js'
export { DoormanError, createCloudSession, type CloudSession } from './session.js'
export { createCloudLibrary } from './library.js'
export { createCloudRoutes } from './routes.js'
