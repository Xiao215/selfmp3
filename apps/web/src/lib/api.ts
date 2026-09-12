/**
 * The web app's API client: `@selfmp3/client`, with a browser behind it.
 *
 * Everything that was here — the request layer, the error mapping and all 74
 * endpoints — now lives in `packages/client`, which the phone uses too. What
 * is left is the part that is genuinely the browser's: it talks to its own
 * page origin under whatever base path this build was made for, carries no
 * credentials because Tailscale is the security boundary, and answers from the
 * bucket instead when this is the GitHub Pages build.
 *
 * The exports are deliberately unchanged, so the 74 call sites across the app
 * did not have to move with it.
 */
import { createApi, createMediaUrl, type ApiTransport } from '@selfmp3/client'

import { CLOUD, appPath } from './platform.js'
import { cloudRequest } from './cloud/routes.js'

/**
 * Same origin, under this build's base path.
 *
 * `appPath` is what makes one build work at `/` on the Mac and at `/selfmp3/`
 * on Pages; every absolute URL the app makes has to respect it.
 */
const transport: ApiTransport = {
  url: (path) => appPath(path),
}

export const api = createApi({
  context: () => ({ transport, fromCloud: CLOUD, cloudRequest }),
  // The browser's own, which satisfies ClientFetch by being itself.
  fetch: (url, init) => fetch(url, init as RequestInit),
})

export const mediaUrl = createMediaUrl(transport)

export { ApiError } from '@selfmp3/client'
