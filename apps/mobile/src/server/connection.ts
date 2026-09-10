import * as SecureStore from 'expo-secure-store'

/**
 * Where the server is and how to authenticate to it.
 *
 * Both values live in the keychain / Android keystore rather than plain
 * AsyncStorage: the token is a real credential, and the hostname is a private
 * Tailscale name that is nobody else's business either. It is two small
 * strings, so the cost of doing it properly is nil.
 */

export interface ServerConnection {
  /** Origin with no trailing slash, e.g. `http://mac-mini.tail1234.ts.net:4173`. */
  readonly baseUrl: string
  /** Optional bearer token, when the server has one configured. */
  readonly token: string | null
}

const BASE_URL_KEY = 'selfmp3.baseUrl'
const TOKEN_KEY = 'selfmp3.token'

/**
 * Accept what someone would actually type — `mac-mini.tail1234.ts.net:4173`,
 * with or without a scheme, with or without a trailing slash — and return a
 * usable origin, or null when it cannot be salvaged.
 */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.hostname.length === 0) return null

  // Keep any path prefix (someone may reverse-proxy at /music) but drop the
  // trailing slash so joining with `/api/...` never doubles up.
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

export async function loadConnection(): Promise<ServerConnection | null> {
  const baseUrl = await SecureStore.getItemAsync(BASE_URL_KEY)
  if (!baseUrl) return null
  const token = await SecureStore.getItemAsync(TOKEN_KEY)
  return { baseUrl, token: token && token.length > 0 ? token : null }
}

export async function saveConnection(connection: ServerConnection): Promise<void> {
  await SecureStore.setItemAsync(BASE_URL_KEY, connection.baseUrl)
  if (connection.token) await SecureStore.setItemAsync(TOKEN_KEY, connection.token)
  else await SecureStore.deleteItemAsync(TOKEN_KEY)
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(BASE_URL_KEY)
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}
