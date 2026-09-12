import * as SecureStore from 'expo-secure-store'

import { normaliseBaseUrl, type ServerConnection } from '@selfmp3/client'

/**
 * Where the server is and how to authenticate to it — the keychain half.
 *
 * The `ServerConnection` shape and `normaliseBaseUrl` moved to
 * `packages/client`, because neither is the phone's: the universal app will ask
 * for the same address in a browser and has to make the same sense of it. What
 * stayed is `expo-secure-store`, which genuinely is.
 *
 * Both values live in the keychain / Android keystore rather than plain
 * AsyncStorage: the token is a real credential, and the hostname is a private
 * Tailscale name that is nobody else's business either. It is two small
 * strings, so the cost of doing it properly is nil.
 */

export { normaliseBaseUrl }
export type { ServerConnection }

const BASE_URL_KEY = 'selfmp3.baseUrl'
const TOKEN_KEY = 'selfmp3.token'

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
