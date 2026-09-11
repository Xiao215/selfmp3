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
  /** Origin with no trailing slash, e.g. `https://mac-mini.tail1234.ts.net`. */
  readonly baseUrl: string
  /** Optional bearer token, when the server has one configured. */
  readonly token: string | null
}

const BASE_URL_KEY = 'selfmp3.baseUrl'
const TOKEN_KEY = 'selfmp3.token'

/**
 * Accept what someone would actually type — `mac-mini.tail1234.ts.net`, with
 * or without a scheme, with or without a trailing slash — and return a usable
 * origin, or null when it cannot be salvaged.
 *
 * A missing scheme is guessed from whether a port was named, because the two
 * ways of reaching the Mac differ in exactly that. `tailscale serve --bg 4600`
 * (docs/SETUP.md) puts the server behind Tailscale's own HTTPS on 443, so a
 * bare hostname is `https://`. A port typed out is someone reaching the server
 * directly, which is plain HTTP. Guessing `http://` for both — which is what
 * this did — makes the address the setup guide produces impossible to enter.
 */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const scheme = /:\d+(?:\/|$)/.test(trimmed) ? 'http' : 'https'
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`

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
