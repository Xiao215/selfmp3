import { createCloudRoutes } from '@selfmp3/cloud'
import { webPlatform } from './webPlatform.js'
import * as session from './session.js'
import { library } from './library.js'

/**
 * The web app's stand-in for the Mac's API (docs/SYNC.md), which is
 * `@selfmp3/cloud`'s with a browser behind it.
 *
 * The route table, what each one does to the library and how an error becomes
 * a status are in the package; the phone answers its own calls from the same
 * table rather than a second copy of it.
 */

export const { cloudRequest } = createCloudRoutes(webPlatform, session, library)

export { CloudRouteError } from '@selfmp3/cloud'
