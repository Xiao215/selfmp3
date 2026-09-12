import { normaliseBaseUrl, type ServerConnection } from '@selfmp3/client'

import { secrets } from '../ports/secrets'

/**
 * Where the server is and how to authenticate to it.
 *
 * The `ServerConnection` shape and `normaliseBaseUrl` moved to
 * `packages/client`, because neither is the phone's: the universal app asks for
 * the same address in a browser and has to make the same sense of it.
 *
 * Where they are kept is the `secrets` port's business, not this file's. On a
 * phone that is the keychain / Android keystore rather than plain AsyncStorage:
 * the token is a real credential, and the hostname is a private Tailscale name
 * that is nobody else's business either. In a browser it is `localStorage`,
 * because a browser has no keychain. This file only knows there are two keys.
 */

export { normaliseBaseUrl }
export type { ServerConnection }

const BASE_URL_KEY = 'selfmp3.baseUrl'
const TOKEN_KEY = 'selfmp3.token'

export async function loadConnection(): Promise<ServerConnection | null> {
  const baseUrl = await secrets.get(BASE_URL_KEY)
  if (!baseUrl) return null
  const token = await secrets.get(TOKEN_KEY)
  return { baseUrl, token: token && token.length > 0 ? token : null }
}

export async function saveConnection(connection: ServerConnection): Promise<void> {
  await secrets.set(BASE_URL_KEY, connection.baseUrl)
  if (connection.token) await secrets.set(TOKEN_KEY, connection.token)
  else await secrets.remove(TOKEN_KEY)
}

export async function clearConnection(): Promise<void> {
  await secrets.remove(BASE_URL_KEY)
  await secrets.remove(TOKEN_KEY)
}
