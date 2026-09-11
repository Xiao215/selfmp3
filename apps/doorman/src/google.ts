import { z } from 'zod'
import type { Fetch } from './bucket.js'
import { fromBase64Url, fromUtf8 } from './encoding.js'
import type { Identity } from './sessions.js'

/**
 * Signing in with Google: OpenID Connect's authorization code flow.
 *
 * The doorman sends the browser to Google with a `state` and a `nonce` it
 * keeps, Google sends it back with a one-time code, and the doorman trades
 * the code for an ID token at Google's token endpoint, with the client
 * secret. The token says who signed in.
 *
 * The token's signature is not checked, and does not need to be: it comes
 * straight from Google's token endpoint, over TLS, in answer to a request
 * made with the client secret — which OpenID Connect Core §3.1.3.7 allows in
 * place of checking the signature. What is checked is what TLS cannot vouch
 * for: that it was issued by Google, for this client, for this sign-in (the
 * nonce), that it has not expired, and that Google has verified the address.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

/**
 * Why signing in with Google did not work. 502 when Google could not be
 * reached or would not take the code; 400 when its answer does not check out.
 */
export class GoogleError extends Error {
  readonly status: 400 | 502

  constructor(message: string, status: 400 | 502) {
    super(message)
    this.name = 'GoogleError'
    this.status = status
  }
}

export interface SignInLink {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly nonce: string
}

/** Google's sign-in page, set up to come back to the doorman. */
export function authUrl(link: SignInLink): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', link.clientId)
  url.searchParams.set('redirect_uri', link.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', link.state)
  url.searchParams.set('nonce', link.nonce)
  // Always ask which account: the one the browser is signed in to is often
  // not the one this self.mp3 knows.
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

const TokenResponseSchema = z.object({ id_token: z.string().min(1) })

export interface CodeExchange {
  readonly fetch: Fetch
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly code: string
}

/** Trade the code Google sent back for an ID token. */
export async function exchangeCode(exchange: CodeExchange): Promise<string> {
  const form = new URLSearchParams({
    code: exchange.code,
    client_id: exchange.clientId,
    client_secret: exchange.clientSecret,
    redirect_uri: exchange.redirectUri,
    grant_type: 'authorization_code',
  })
  let response: Response
  try {
    response = await exchange.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form.toString(),
    })
  } catch {
    throw new GoogleError('could not reach Google', 502)
  }
  if (!response.ok) {
    // Google's answer says why (invalid_grant, invalid_client…) and holds nothing secret.
    const reason = await response.text().catch(() => '')
    throw new GoogleError(
      `Google refused the code (${response.status}): ${reason.slice(0, 200)}`,
      502,
    )
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new GoogleError('Google answered with something that is not JSON', 502)
  }
  const parsed = TokenResponseSchema.safeParse(data)
  if (!parsed.success) throw new GoogleError('Google answered without an ID token', 502)
  return parsed.data.id_token
}

const ClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1),
  exp: z.number(),
  nonce: z.string().optional(),
  email: z.string().min(3),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
})

export interface IdTokenCheck {
  readonly clientId: string
  readonly nonce: string
  readonly now: number
}

/** Who the ID token says signed in, once everything about it checks out. */
export function checkIdToken(idToken: string, check: IdTokenCheck): Identity {
  const refuse = (why: string): GoogleError => new GoogleError(why, 400)
  const parts = idToken.split('.')
  const payload = parts.length === 3 && parts[1] ? fromBase64Url(parts[1]) : null
  if (!payload) throw refuse('the ID token is not a JWT')

  let data: unknown
  try {
    data = JSON.parse(fromUtf8(payload))
  } catch {
    throw refuse('the ID token is not JSON')
  }
  const parsed = ClaimsSchema.safeParse(data)
  if (!parsed.success) throw refuse('the ID token is missing something')
  const claims = parsed.data

  if (!ISSUERS.has(claims.iss)) throw refuse('the ID token is not from Google')
  if (claims.aud !== check.clientId) throw refuse('the ID token is for another app')
  if (claims.exp * 1000 <= check.now) throw refuse('the ID token has expired')
  if (claims.nonce !== check.nonce) throw refuse('the ID token is for another sign-in')
  if (claims.email_verified !== true) throw refuse('Google has not verified the address')

  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  }
}
