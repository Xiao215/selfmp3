import { z } from 'zod'
import { keep } from './boundedCache.js'
import { sha256Hex } from './encoding.js'
import { DRIVE_RECONNECT } from './drive.js'
import { StoreError, type Fetch } from './store.js'

/**
 * Google's access tokens for the accounts that keep their library in Google
 * Drive (drive.ts).
 *
 * What the doorman keeps for such an account is a refresh token, sealed with
 * the rest of its storage (accounts.ts). Google trades it for an access token
 * good for an hour, which is what every request to Drive carries. Trading
 * costs a request to Google and nothing else — no KV write, ever — so each
 * Worker instance makes its own and keeps it until five minutes before it
 * runs out, under a hash of the refresh token, never the token itself.
 *
 * A refresh token stops working when the person takes self.mp3's access away
 * at myaccount.google.com, when it goes unused for six months, or after seven
 * days while the OAuth app is still in Testing (apps/doorman/README.md). Google
 * then answers `invalid_grant`, which is told as a refused key is: connect
 * again.
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/** A token is let go this long before Google would stop taking it. */
const EARLY_MS = 5 * 60_000

const TOKEN_TIMEOUT_MS = 30_000

const RefreshedSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
})

interface AccessToken {
  readonly token: string
  readonly until: number
}

/** Access tokens being made or in hand, by a hash of the refresh token each came from. */
export type GoogleTokenCache = Map<string, Promise<AccessToken>>

export interface GoogleClient {
  readonly clientId: string
  readonly clientSecret: string
}

/** The OAuth client the Worker's settings name, or null while either half is missing. */
export function googleClientOf(env: {
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
}): GoogleClient | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export class GoogleTokens {
  readonly #fetch: Fetch
  readonly #now: () => number
  readonly #client: GoogleClient | null
  readonly #cache: GoogleTokenCache

  constructor(
    fetch: Fetch,
    now: () => number,
    client: GoogleClient | null,
    cache: GoogleTokenCache,
  ) {
    this.#fetch = fetch
    this.#now = now
    this.#client = client
    this.#cache = cache
  }

  /** An access token for the account the refresh token belongs to: in hand, or made now. */
  async access(refreshToken: string): Promise<string> {
    const id = await sha256Hex(refreshToken)
    for (;;) {
      const held = this.#cache.get(id)
      if (held) {
        const token = await held.catch(() => null)
        if (token && token.until > this.#now()) return token.token
        // Another request waiting on the same one may have begun the next
        // already: wait on that rather than asking Google a second time.
        if (this.#cache.get(id) !== held) continue
      }
      // Kept while it is being made, so a burst of requests asks Google once.
      const making = this.#refresh(refreshToken)
      keep(this.#cache, id, making)
      try {
        return (await making).token
      } catch (error) {
        if (this.#cache.get(id) === making) this.#cache.delete(id)
        throw error
      }
    }
  }

  /**
   * Let go of an access token Drive would not take. Only that one: a request
   * refused a moment after another's must not throw away the token the other
   * has just had made.
   */
  async forget(refreshToken: string, refused: string): Promise<void> {
    const id = await sha256Hex(refreshToken)
    const held = this.#cache.get(id)
    const token = held ? await held.catch(() => null) : null
    if (this.#cache.get(id) === held && (!token || token.token === refused)) this.#cache.delete(id)
  }

  /**
   * Tell Google the refresh token is done with, when its account disconnects
   * Drive or connects a bucket instead. Google ends the app's whole access to
   * the account with it, which is the point, and why this is never called for
   * an account that still keeps its library in Drive. Google's answer changes nothing here —
   * the doorman has already forgotten the token — so a failure is only thrown
   * for the log.
   */
  async revoke(refreshToken: string): Promise<void> {
    this.#cache.delete(await sha256Hex(refreshToken))
    const response = await this.#fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    await response.body?.cancel()
    if (!response.ok) throw new Error(`Google answered a revoke with ${response.status}`)
  }

  async #refresh(refreshToken: string): Promise<AccessToken> {
    if (!this.#client) {
      throw new StoreError('other', 'This self.mp3 is not set up for Google Drive.')
    }
    let response: Response
    try {
      response = await this.#fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: this.#client.clientId,
          client_secret: this.#client.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      })
    } catch {
      throw new StoreError('network', 'Could not reach Google.')
    }
    const answer: unknown = await response.json().catch(() => null)
    if (response.ok) {
      const parsed = RefreshedSchema.safeParse(answer)
      if (!parsed.success) {
        throw new StoreError('other', 'Google answered without an access token.')
      }
      return {
        token: parsed.data.access_token,
        until: this.#now() + parsed.data.expires_in * 1000 - EARLY_MS,
      }
    }
    if (response.status === 429 || response.status >= 500) {
      throw new StoreError('busy', 'Google is busy. Try again in a moment.')
    }
    const reason = z.object({ error: z.string() }).safeParse(answer)
    if (reason.success && reason.data.error === 'invalid_grant') {
      throw new StoreError(
        'auth',
        `self.mp3 no longer has access to your Google Drive. ${DRIVE_RECONNECT}`,
      )
    }
    // invalid_client and the like: the Worker's own settings, not the account's.
    throw new StoreError('other', 'Google would not give this self.mp3 access to Google Drive.')
  }
}
