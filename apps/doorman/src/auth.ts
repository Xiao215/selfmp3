import {
  DoormanClaimRequestSchema,
  SignInAttemptSchema,
  type DoormanClaimResult,
} from '@selfmp3/shared'
import { z } from 'zod'
import { allowedEmails, type Context } from './context.js'
import { randomToken } from './encoding.js'
import { GoogleError, authUrl, checkIdToken, exchangeCode } from './google.js'
import { page } from './html.js'
import { json, noContent, readJson, unauthorized } from './http.js'
import { getRecord, putRecord } from './kv.js'
import { bearerToken, type Identity } from './sessions.js'

/**
 * Signing in, for a device that may not be where Google's page opens.
 *
 * The device makes up a sign-in attempt — 32 random hex characters — and
 * opens `/v1/auth/start?attempt=…` wherever it can: a new tab, or Safari when
 * it is an iPhone home-screen app. Google sends that browser back to
 * `/v1/auth/callback`, which makes the session and leaves it under the
 * attempt for ten minutes. Meanwhile the device asks `/v1/auth/claim` with
 * its attempt every few seconds and gets the session the first time it is
 * there. Nothing has to find its way back into the app; the app goes to it.
 *
 * The attempt never goes to Google. It waits in KV beside a `state` (which
 * Google does carry, and which proves the callback belongs to a sign-in this
 * doorman started) and a `nonce` (which Google puts in the ID token, and which
 * proves the token was issued for this sign-in and no other).
 *
 * A claim hands the session over once: the attempt is deleted as it is
 * claimed. KV has no "read and delete" in one step, so two claims racing
 * each other to the same key from different places could, in principle, both
 * win; the attempt is a 128-bit secret only the device and its browser know.
 *
 * KV also remembers, for up to a minute, that a key was missing. A device
 * that reaches Cloudflare somewhere other than where its browser did may be
 * told "pending" for that long after the browser has finished, so a device
 * should keep asking for a couple of minutes before it gives up.
 */

const STATE_TTL_SECONDS = 10 * 60
const ATTEMPT_TTL_SECONDS = 10 * 60

/** base64url of 32 random bytes, as `randomToken` makes them. */
const STATE = /^[A-Za-z0-9_-]{43}$/

const StateRecordSchema = z.object({
  attempt: SignInAttemptSchema,
  /** Where the browser goes afterwards: an address in APP_ORIGINS, or nowhere. */
  returnTo: z.string().nullable(),
  nonce: z.string(),
})
type StateRecord = z.infer<typeof StateRecordSchema>

const AttemptRecordSchema = z.object({ token: z.string() })

/** `GET /v1/auth/start?attempt=<id>&return=<url>` — off to Google. */
export async function start(ctx: Context): Promise<Response> {
  const attempt = SignInAttemptSchema.safeParse(ctx.url.searchParams.get('attempt'))
  if (!attempt.success) {
    return page({
      status: 400,
      title: 'This sign-in link is not right',
      lines: ['Start again from self.mp3.'],
    })
  }
  const google = googleClient(ctx)
  if (!google) return notSetUpPage()
  // Say so before the trip to Google, rather than after it.
  if (allowedEmails(ctx.env.ALLOWED_EMAILS).size === 0) return nobodyAllowedPage()

  const state = randomToken()
  const nonce = randomToken()
  const record: StateRecord = {
    attempt: attempt.data,
    returnTo: safeReturn(ctx.url.searchParams.get('return'), ctx.origins),
    nonce,
  }
  await putRecord(ctx.env.KV, `state:${state}`, record, STATE_TTL_SECONDS)

  // Built by hand rather than with Response.redirect, whose headers cannot be
  // added to afterwards (CORS adds some to every answer).
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl({ clientId: google.clientId, redirectUri: redirectUri(ctx), state, nonce }),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

/** `GET /v1/auth/callback?code=…&state=…` — Google sends the browser back here. */
export async function callback(ctx: Context): Promise<Response> {
  const params = ctx.url.searchParams
  const state = params.get('state') ?? ''
  const stored = STATE.test(state)
    ? await getRecord(ctx.env.KV, `state:${state}`, StateRecordSchema)
    : null
  if (!stored) return expiredPage()
  // Used once, whatever happens next.
  await ctx.env.KV.delete(`state:${state}`)

  const refused = params.get('error')
  if (refused !== null) {
    // Google's reason is a short code, like access_denied. Anything else is not shown.
    const reason = /^[a-z_]{1,40}$/.test(refused) ? ` (${refused})` : ''
    return page({
      status: 400,
      title: 'Not signed in',
      lines: [`Google did not sign you in${reason}.`, 'Start again from self.mp3.'],
    })
  }
  const code = params.get('code')
  if (!code) return expiredPage()

  const google = googleClient(ctx)
  if (!google) return notSetUpPage()

  let identity: Identity
  try {
    const idToken = await exchangeCode({
      fetch: ctx.fetch,
      code,
      redirectUri: redirectUri(ctx),
      ...google,
    })
    identity = checkIdToken(idToken, {
      clientId: google.clientId,
      nonce: stored.nonce,
      now: ctx.now(),
    })
  } catch (error) {
    if (!(error instanceof GoogleError)) throw error
    // The reason goes to the Worker's log, for the owner; the page stays plain.
    ctx.log.warn('a sign-in failed', { reason: error.message })
    return page({
      status: error.status,
      title: 'Not signed in',
      lines: ['Google could not finish signing you in.', 'Start again from self.mp3.'],
    })
  }

  const allowed = allowedEmails(ctx.env.ALLOWED_EMAILS)
  if (allowed.size === 0) return nobodyAllowedPage()
  if (!allowed.has(identity.email.toLowerCase())) {
    return page({
      status: 403,
      title: 'Not allowed',
      lines: [
        `This Google account (${identity.email}) is not allowed on this self.mp3.`,
        'Sign in with the account its owner added, or ask them to add this one.',
      ],
    })
  }

  // The attempt goes last: whoever can see it can then see the session and
  // the account too, since KV has never been asked for those keys before.
  const token = await ctx.sessions.create(identity)
  await ctx.accounts.signedIn(identity)
  await putRecord(ctx.env.KV, `attempt:${stored.attempt}`, { token }, ATTEMPT_TTL_SECONDS)

  return page({
    status: 200,
    title: 'Signed in',
    lines: [`Signed in as ${identity.email}.`, 'You can go back to self.mp3.'],
    next: stored.returnTo ? withFragment(stored.returnTo, `signin=${stored.attempt}`) : null,
  })
}

/** `POST /v1/auth/claim { attempt }` — the device asking whether its sign-in is done. */
export async function claim(ctx: Context): Promise<Response> {
  const { attempt } = await readJson(ctx.request, DoormanClaimRequestSchema)
  const key = `attempt:${attempt}`
  const record = await getRecord(ctx.env.KV, key, AttemptRecordSchema)
  const pending: DoormanClaimResult = { status: 'pending' }
  if (!record) return json(pending)
  // Nobody but this device can have the token yet, so its session is there.
  // Should KV not show it here yet, the attempt is left for the next ask.
  const session = await ctx.sessions.find(record.token)
  if (!session) return json(pending)
  await ctx.env.KV.delete(key)

  const account = await ctx.accounts.get(session.sub)
  const result: DoormanClaimResult = {
    status: 'signed-in',
    token: record.token,
    me: await ctx.accounts.me(
      session.sub,
      account ?? {
        email: session.email,
        name: session.name,
        picture: session.picture,
        storage: null,
      },
    ),
  }
  return json(result)
}

/** `POST /v1/auth/signout` — this device's session ends. */
export async function signOut(ctx: Context): Promise<Response> {
  const token = bearerToken(ctx.request)
  // Looked up before it is deleted: a delete costs a KV write even when
  // there is nothing to delete, and a made-up token should cost nothing.
  if (!token || !(await ctx.sessions.end(token))) throw unauthorized()
  return noContent()
}

function googleClient(ctx: Context): { clientId: string; clientSecret: string } | null {
  const clientId = ctx.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = ctx.env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Google must be told the same address when the code is traded as when it was asked for. */
function redirectUri(ctx: Context): string {
  return `${ctx.url.origin}/v1/auth/callback`
}

/**
 * Where to send the browser after signing in: only an address in APP_ORIGINS.
 * Anything else is dropped, not refused — the sign-in still works, it just
 * ends on the doorman's own page — so the doorman never becomes a way to send
 * someone to a site of an attacker's choosing.
 */
function safeReturn(value: string | null, origins: ReadonlySet<string>): string | null {
  if (!value || value.length > 2000) return null
  try {
    const url = new URL(value)
    return origins.has(url.origin) ? url.toString() : null
  } catch {
    return null
  }
}

function withFragment(address: string, fragment: string): string {
  const url = new URL(address)
  url.hash = fragment
  return url.toString()
}

function expiredPage(): Promise<Response> {
  return page({
    status: 400,
    title: 'This sign-in has expired',
    lines: ['Start again from self.mp3.'],
  })
}

function nobodyAllowedPage(): Promise<Response> {
  return page({
    status: 403,
    title: 'Nobody can sign in yet',
    lines: [
      'This self.mp3 does not have a list of Google accounts that may sign in.',
      'Its owner lists them in the ALLOWED_EMAILS secret.',
    ],
  })
}

function notSetUpPage(): Promise<Response> {
  return page({
    status: 500,
    title: 'Not set up yet',
    lines: [
      'This self.mp3 has not been connected to Google yet.',
      'Its owner sets GOOGLE_CLIENT_ID in wrangler.toml and GOOGLE_CLIENT_SECRET as a secret.',
    ],
  })
}
