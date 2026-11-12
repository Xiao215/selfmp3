/**
 * Names the server, the app and its service worker have to agree on that are
 * not a schema: the error codes a client decides by, and the one header of
 * the app's own. Without zod, so the service worker can carry it
 * (`@selfmp3/shared/wire`), as doormanWire.ts says.
 *
 * A client that reads a code to choose what to say — "instrumental" rather
 * than "no lyrics found", nothing at all rather than "the model is off" —
 * used to spell it out where it read it, and the server where it wrote it.
 */

/**
 * The `code` of an answer that a client acts on. Not every code the server
 * sends: the rest are only ever shown, never compared.
 */
export const API_ERROR = {
  /** No answer: the device is offline, or there is no server to ask. Read as status 0. */
  offline: 'offline',
  /** A 404 for a song's words that says it has none: an instrumental. */
  instrumental: 'instrumental',
  /** An answer that did not fit its schema: the server and this build disagree. */
  contractMismatch: 'contract_mismatch',
  /** A route a cloud library cannot answer from the bucket: only the server can. */
  needsServer: 'needs_server',
  /** A write the server's disk had no room for (507): said as that, not as a 500. */
  diskFull: 'disk_full',
  /** A write held up by another hold on the database (503): try again in a moment. */
  databaseBusy: 'database_busy',
} as const

/**
 * Why a model did not answer, as the code each failure is sent with
 * (`ai_off` when no model is set up). Keyed by the server's `LlmError` kinds.
 */
export const AI_ERROR = {
  off: 'ai_off',
  busy: 'ai_busy',
  unreachable: 'ai_unreachable',
  refused: 'ai_refused',
  invalid: 'ai_invalid',
  stopped: 'ai_stopped',
} as const

/**
 * How a download says it wants the file itself, not the copy the service
 * worker already keeps. The server names it in its CORS preflight, or a
 * cross-origin download that sends it is refused before it starts.
 */
export const REFRESH_HEADER = 'x-selfmp3-refresh'

/**
 * A device's file for an import, described: the SHA-256 of its bytes, and
 * what the player said about it (`ImportDeviceFileMetaSchema`, base64url
 * JSON). Headers rather than a form, so the body is the file and nothing
 * else; the server names both in its CORS preflight.
 */
export const IMPORT_SHA256_HEADER = 'x-selfmp3-sha256'
export const IMPORT_META_HEADER = 'x-selfmp3-import-meta'
