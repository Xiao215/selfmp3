import {
  DoormanClaimRequestSchema,
  SignInAttemptSchema,
  formatSignInCode,
  type DoormanClaimResult,
} from '@selfmp3/shared'
import { z } from 'zod'
import { allowedEmails, isAllowed, requireSession, type Context } from './context.js'
import { randomToken } from './encoding.js'
import { GoogleError, authUrl, checkIdToken, exchangeCode } from './google.js'
import { page } from './html.js'
import { DoormanError, forbidden, json, noContent, readJson, unauthorized } from './http.js'
import type { DoormanKeys } from './keys.js'
import { getRecord, putRecord } from './kv.js'
import { bearerToken, type Identity } from './sessions.js'
import {
  SIGN_IN_TTL_MS,
  codeMatches,
  codeTag,
  newSignInCode,
  openState,
  pkceChallenge,
  pkceVerifier,
  signInTtlInWords,
  signState,
} from './signin.js'

/**
 * Signing in, for a device that may not be where Google's page opens.
 *
 * The device makes up a sign-in attempt — 32 random hex characters — and
 * opens `/v1/auth/start?attempt=…` wherever it can: a new tab, or a sheet of
 * its own in an iPhone home-screen app. Google sends that browser back to
 * `/v1/auth/callback`, which shows a one-time code: on its own page, or in
 * the fragment of the app address it sends the browser back to
 * (`#signin-code=…`). The device claims its session with the attempt and
 * that code, from the fragment or typed in by hand. Until it has the code it
 * may ask with the attempt alone, and hears "pending", then "code".
 *
 * The code is what makes the session the signed-in person's own. Someone
 * who gets you to open a start link of their making knows its attempt, but
 * never sees the code you are shown, and has one guess at it: a wrong code
 * ends the attempt. The two never travel together: the attempt goes to
 * Google and back inside the signed state, and the code comes only on the
 * doorman's page or in the fragment of the app's address.
 *
 * Starting writes nothing (see signin.ts), and neither does anything before
 * Google has vouched for an address on the list: the callback's one write is
 * the identity and a MAC of the code, under the attempt, for ten minutes.
 * The session itself is made only when the code is claimed, so no token is
 * ever stored. A whole sign-in costs three KV writes.
 *
 * KV has no "read and delete" in one step, so two claims racing each other
 * from different places could, in principle, both succeed. Both would need
 * the attempt and the code. KV also remembers, for up to a minute, that a key
 * was missing: a device reaching Cloudflare somewhere other than where its
 * browser did may hear "pending" for that long after Google has finished.
 */

const ATTEMPT_TTL_SECONDS = SIGN_IN_TTL_MS / 1000

/** What the callback leaves under the attempt for the claim. No code, no token. */
const AttemptRecordSchema = z.object({
  sub: z.string().min(1),
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
  /** A MAC of the code shown, tied to the attempt (see signin.ts). */
  codeTag: z.string(),
  /** Milliseconds; KV's own expiry is the backstop. */
  expiresAt: z.number(),
})
type AttemptRecord = z.infer<typeof AttemptRecordSchema>

/** The one answer to a code that is not the right one, or has nothing to be right for. */
const wrongCode = (): DoormanError =>
  new DoormanError(403, 'wrong_code', 'That isn’t the code shown after signing in. Start again.')

/** `GET /v1/auth/start?attempt=<id>&return=<url>` — off to Google, writing nothing. */
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
  const keys = await keysOrNull(ctx)
  if (!google || !keys) return notSetUpPage()
  // Say so before the trip to Google, rather than after it.
  if (allowedEmails(ctx.env.ALLOWED_EMAILS).size === 0) return nobodyAllowedPage()

  const nonce = randomToken()
  const state = await signState(
    {
      attempt: attempt.data,
      returnTo: safeReturn(
        ctx.url.searchParams.get('return'),
        ctx.origins,
        appSchemes(ctx.env.APP_SCHEMES),
      ),
      nonce,
      exp: ctx.now() + SIGN_IN_TTL_MS,
    },
    keys.state,
  )
  const codeChallenge = await pkceChallenge(await pkceVerifier(nonce, keys.pkce))

  // Built by hand rather than with Response.redirect, whose headers cannot be
  // added to afterwards (CORS adds some to every answer).
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl({
        clientId: google.clientId,
        redirectUri: redirectUri(ctx),
        state,
        nonce,
        codeChallenge,
      }),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

/** `GET /v1/auth/callback?code=…&state=…` — Google sends the browser back here. */
export async function callback(ctx: Context): Promise<Response> {
  const keys = await keysOrNull(ctx)
  const google = googleClient(ctx)
  if (!keys || !google) return notSetUpPage()

  const params = ctx.url.searchParams
  const state = await openState(params.get('state') ?? '', keys.state, ctx.now())
  if (!state) return expiredPage()

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

  let identity: Identity
  try {
    const idToken = await exchangeCode({
      fetch: ctx.fetch,
      code,
      codeVerifier: await pkceVerifier(state.nonce, keys.pkce),
      redirectUri: redirectUri(ctx),
      ...google,
    })
    identity = checkIdToken(idToken, {
      clientId: google.clientId,
      nonce: state.nonce,
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
  if (!allowed.has(identity.email.toLowerCase())) return notAllowedPage(identity.email)

  // Google has vouched for an address on the list: the sign-in's first write.
  const signInCode = newSignInCode()
  const record: AttemptRecord = {
    ...identity,
    codeTag: await codeTag(state.attempt, signInCode, keys.code),
    expiresAt: ctx.now() + SIGN_IN_TTL_MS,
  }
  await putRecord(ctx.env.KV, attemptKey(state.attempt), record, ATTEMPT_TTL_SECONDS)

  if (state.returnTo) {
    // Back to the app, with the code where only that browser can read it:
    // a fragment never leaves the browser, and never names the attempt.
    return new Response(null, {
      status: 302,
      headers: {
        location: withFragment(state.returnTo, `signin-code=${signInCode}`),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    })
  }
  return page({
    status: 200,
    title: 'Your sign-in code',
    lines: [`Google has signed you in as ${identity.email}.`],
    code: formatSignInCode(signInCode),
    notes: [
      'Go back to self.mp3 — it asks for this code if it needs it.',
      `It works once, for ${signInTtlInWords()}. Never type it anywhere else, or give it to anyone.`,
    ],
  })
}

/**
 * `POST /v1/auth/claim { attempt, code? }` — the device asking how its sign-in
 * stands, or claiming it with the code it was shown.
 */
export async function claim(ctx: Context): Promise<Response> {
  const request = await readJson(ctx.request, DoormanClaimRequestSchema)
  const key = attemptKey(request.attempt)
  const record = await getRecord(ctx.env.KV, key, AttemptRecordSchema)
  const live = record && record.expiresAt > ctx.now() ? record : null

  if (request.code === undefined) {
    const status: DoormanClaimResult = live ? { status: 'code' } : { status: 'pending' }
    return json(status)
  }

  const keys = await ctx.keys()
  if (!live || !(await codeMatches(request.attempt, request.code, live.codeTag, keys.code))) {
    // One guess per attempt. A made-up attempt has nothing to end, and costs
    // no KV write: deleting a key that is not there still counts as one.
    if (record) await ctx.env.KV.delete(key)
    throw wrongCode()
  }
  if (!isAllowed(live.email, ctx.env.ALLOWED_EMAILS)) {
    await ctx.env.KV.delete(key)
    throw forbidden('This Google account is not allowed on this self.mp3.')
  }

  const { token, session } = await ctx.sessions.create(live)
  await ctx.env.KV.delete(key)
  const result: DoormanClaimResult = {
    status: 'signed-in',
    token,
    me: await ctx.accounts.me(session),
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

/**
 * `POST /v1/auth/signout-everywhere` — every session the account has ends,
 * this one included: what to do about a lost device. One KV write.
 */
export async function signOutEverywhere(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  await ctx.accounts.signOutEverywhere(session.sub)
  return noContent()
}

function attemptKey(attempt: string): string {
  return `attempt:${attempt}`
}

async function keysOrNull(ctx: Context): Promise<DoormanKeys | null> {
  try {
    return await ctx.keys()
  } catch {
    return null
  }
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
 * Where to send the browser after signing in: an address in APP_ORIGINS, or
 * this computer (`http://localhost` or `http://127.0.0.1`, any port) for the
 * server's own settings page. Anything else is dropped, not refused — the
 * sign-in still works, and ends on the doorman's page with the code — so the
 * doorman never sends anyone, or any code, to a site of someone else's
 * choosing. The loopback exception is for this redirect only, never CORS.
 */
function safeReturn(
  value: string | null,
  origins: ReadonlySet<string>,
  schemes: ReadonlySet<string> = new Set(),
): string | null {
  if (!value || value.length > 1024) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  /*
   * An origin only counts when the address is a web address.
   *
   * `blob:https://app.example/…` reports the origin inside it as its own, so
   * matching on the origin alone would let one through against a list it was
   * never on. The scheme has to be checked with it, not instead of it.
   */
  const web = url.protocol === 'http:' || url.protocol === 'https:'
  const loopback =
    url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  // A phone has no origin to come back to, so it is named by its scheme
  // instead. That is weaker than an origin — iOS lets any app claim a scheme,
  // so another one could take this redirect — and it is safe here for the
  // reason the code exists at all: what comes back is the code alone, and a
  // session needs the attempt too, which was made on the device and never
  // left it. Whoever intercepts this holds half of a pair.
  const native = schemes.has(url.protocol)
  return (web && (origins.has(url.origin) || loopback)) || native ? url.toString() : null
}

/** `selfmp3` or `selfmp3://` in the setting, `selfmp3:` as `URL` reports it. */
export function appSchemes(value: string | undefined): ReadonlySet<string> {
  const listed = (value ?? 'selfmp3')
    .split(',')
    .map(each => each.trim().toLowerCase().replace(/:\/*$/, ''))
    .filter(each => /^[a-z][a-z0-9+.-]*$/.test(each))
  return new Set(listed.map(each => `${each}:`))
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

function notAllowedPage(email: string): Promise<Response> {
  return page({
    status: 403,
    title: 'Not allowed',
    lines: [
      `This Google account (${email}) is not allowed on this self.mp3.`,
      'Sign in with the account its owner added, or ask them to add this one.',
    ],
  })
}

function notSetUpPage(): Promise<Response> {
  return page({
    status: 500,
    title: 'Not set up yet',
    lines: [
      'This self.mp3 has not been set up to sign anyone in yet.',
      'Its owner sets GOOGLE_CLIENT_ID in wrangler.toml, and GOOGLE_CLIENT_SECRET and SEAL_KEY as secrets.',
    ],
  })
}
