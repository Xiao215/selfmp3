/**
 * `@selfmp3/client/core` — the part of the package with no React in it.
 *
 * The barrel carries the query hooks, and with them React and React Query. The
 * browser extension's background worker wants the API client, which server
 * answers and the import rules, and nothing that renders; a bundle of the barrel
 * would pull the rest in with them (docs/features/browser-extension.md).
 */
export type {
  ApiContext,
  ApiTransport,
  ClientFetch,
  ClientRequestInit,
  ClientResponse,
  CloudRequest,
} from './platform.js'

export { ApiError, failureText } from './api/error.js'
export { createApi, type Api, type ApiOptions } from './api/api.js'

export {
  normaliseBaseUrl,
  serverTransport,
  type ServerConnection,
} from './connection/connection.js'
export * from './connection/reach.js'

export * from './import/model.js'

export * from './theme/oklch.js'
export * from './theme/tokens.js'
