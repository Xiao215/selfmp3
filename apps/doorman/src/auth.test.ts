import {
  DoormanClaimResultSchema,
  DoormanMeSchema,
  ErrorBodySchema,
  formatSignInCode,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import {
  fromBase64Url,
  fromUtf8,
  sha256Base64,
  sha256Hex,
  toBase64,
  toBase64Url,
  utf8,
} from './encoding.js'
import {
  APP_ORIGIN,
  CLIENT_ID,
  DOORMAN_ORIGIN,
  EXTENSION_RETURN,
  ME,
  harness,
  idTokenClaims,
  newAttempt,
  signInCodeFrom,
  type Harness,
  type Profile,
} from './fakes.js'
import { appSchemes } from './auth.js'

/**
 * Signing in, end to end: the device's start link, Google's round trip (a fake
 * token endpoint that issues whatever ID token the test asks for, and checks
 * PKCE as Google does), the code the browser is shown, and the device
 * claiming its session with it.
 */

interface Started {
  readonly attempt: string
  readonly start: Response
  readonly google: URL
  readonly state: string
  readonly nonce: string
  readonly challenge: string
}

/** Open a start link, as a device (or someone else) would, and read where it sends the browser. */
async function begin(h: Harness, query = '', attempt = newAttempt()): Promise<Started> {
  const start = await h.call(`/v1/auth/start?attempt=${attempt}${query}`)
  const google = new URL(start.headers.get('location') ?? 'about:blank')
  return {
    attempt,
    start,
    google,
    state: google.searchParams.get('state') ?? '',
    nonce: google.searchParams.get('nonce') ?? '',
    challenge: google.searchParams.get('code_challenge') ?? '',
  }
}

/** Google sending the browser back, after `profile` signed in. */
function finish(
  h: Harness,
  started: Started,
  profile: Profile = ME,
  changes: Record<string, unknown> = {},
): Promise<Response> {
  const code = h.google.code(
    idTokenClaims(profile, started.nonce, h.clock, changes),
    started.challenge,
  )
  return h.call(`/v1/auth/callback?state=${started.state}&code=${encodeURIComponent(code)}`)
}

function claim(h: Harness, attempt: string, code?: string): Promise<Response> {
  return h.call('/v1/auth/claim', { json: code === undefined ? { attempt } : { attempt, code } })
}

async function claimed(h: Harness, attempt: string, code?: string) {
  const response = await claim(h, attempt, code)
  expect(response.status).toBe(200)
  return DoormanClaimResultSchema.parse(await response.json())
}

async function refused(response: Response) {
  expect(response.status).toBe(403)
  return ErrorBodySchema.parse(await response.json())
}

/** The state's payload, which is signed but not secret. */
function statePayload(state: string): Record<string, unknown> {
  const payload = fromBase64Url(state.slice(0, state.lastIndexOf('.'))) ?? new Uint8Array()
  return JSON.parse(fromUtf8(payload)) as Record<string, unknown>
}

/** A well-formed code that is not `code`. */
function otherCode(code: string): string {
  return code.startsWith('2') ? `3${code.slice(1)}` : `2${code.slice(1)}`
}

const WRONG_CODE = {
  error: 'That isn’t the code shown after signing in. Start again.',
  code: 'wrong_code',
}

describe('starting a sign-in', () => {
  it('sends the browser to Google with a signed state, a nonce and PKCE, writing nothing', async () => {
    const h = harness()
    const { attempt, start, google, state, nonce, challenge } = await begin(h)

    expect(start.status).toBe(302)
    expect(start.headers.get('cache-control')).toBe('no-store')
    expect(`${google.origin}${google.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(Object.fromEntries(google.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: `${DOORMAN_ORIGIN}/v1/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(statePayload(state)).toEqual({
      attempt,
      returnTo: null,
      nonce,
      exp: h.clock.now + 10 * 60_000,
    })
    // Anyone can open a start link, so it costs no KV write at all.
    expect(h.kv.writes).toBe(0)
    expect(h.kv.dump()).toEqual([])
  })

  it('keeps a return address on the app, or on this computer', async () => {
    const h = harness()
    for (const address of [
      `${APP_ORIGIN}/selfmp3/settings?tab=cloud`,
      'http://localhost:4600/settings',
      'http://localhost/',
      'http://127.0.0.1:8123/cloud',
    ]) {
      const { state } = await begin(h, `&return=${encodeURIComponent(address)}`)
      expect(statePayload(state).returnTo, address).toBe(address)
    }
  })

  it('drops a return address that is anyone else’s', async () => {
    const h = harness()
    for (const address of [
      'https://evil.example/selfmp3/',
      'https://xiao215.github.io.evil.example/',
      'http://localhost.evil.example/',
      'http://127.0.0.2/',
      'https://localhost:4600/',
      'javascript:alert(1)',
      // A blob URL reports the origin inside it as its own, so this would
      // otherwise have matched the list exactly.
      `blob:${APP_ORIGIN}/1b3f0c2e-0000-4000-8000-000000000000`,
      `data:text/html,<script>alert(1)</script>`,
      '//evil.example/',
      'not a url',
      `${APP_ORIGIN}/${'x'.repeat(1100)}`,
    ]) {
      const { start, state } = await begin(h, `&return=${encodeURIComponent(address)}`)
      expect(start.status).toBe(302)
      expect(statePayload(state).returnTo, address).toBeNull()
    }
  })

  it('refuses an attempt that is not 32 hex characters, and writes nothing', async () => {
    const h = harness()
    for (const attempt of ['', 'abc', 'A'.repeat(32), 'g'.repeat(32), `${newAttempt()}0`]) {
      const response = await h.call(`/v1/auth/start?attempt=${attempt}`)
      expect(response.status).toBe(400)
      expect(response.headers.get('content-type')).toMatch(/^text\/html/)
      expect(await response.text()).toMatch(/This sign-in link is not right/)
    }
    expect((await h.call('/v1/auth/start')).status).toBe(400)
    expect(h.kv.writes).toBe(0)
  })

  it('says so at once when nobody is allowed to sign in', async () => {
    const h = harness()
    for (const list of [undefined, '', ' ,  ']) {
      h.env.ALLOWED_EMAILS = list
      const response = await h.call(`/v1/auth/start?attempt=${newAttempt()}`)
      expect(response.status).toBe(403)
      expect(await response.text()).toMatch(/Nobody can sign in yet/)
    }
    expect(h.kv.writes).toBe(0)
  })

  it('says the doorman is not set up without a Google client or a SEAL_KEY', async () => {
    for (const change of [{ GOOGLE_CLIENT_ID: '' }, { SEAL_KEY: undefined }, { SEAL_KEY: 'x' }]) {
      const h = harness()
      Object.assign(h.env, change)
      const response = await h.call(`/v1/auth/start?attempt=${newAttempt()}`)
      expect(response.status).toBe(500)
      expect(await response.text()).toMatch(/Not set up yet/)
    }
  })
})

describe('coming back from Google', () => {
  it('shows the code on the doorman’s page, and keeps only who it is and a MAC of it', async () => {
    const h = harness()
    const started = await begin(h)
    const back = await finish(h, started)

    expect(back.status).toBe(200)
    const code = (await signInCodeFrom(back)) ?? ''
    const html = await back.text()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(html).toContain(`<p class="code">${formatSignInCode(code)}</p>`)
    expect(html).toContain('Google has signed you in as me@example.com.')
    expect(html).toContain('Go back to self.mp3 — it asks for this code if it needs it.')

    // One write, under the attempt, for ten minutes: no session, no token, no code.
    expect(h.kv.writes).toBe(1)
    const [kept] = h.kv.dump()
    expect(kept?.key).toBe(`attempt:${started.attempt}`)
    expect(kept?.ttlSeconds).toBe(600)
    expect(Object.keys(JSON.parse(kept?.value ?? '') as object).sort()).toEqual([
      'codeTag',
      'email',
      'expiresAt',
      'name',
      'picture',
      'sub',
    ])
    expect(kept?.value).not.toContain(code)
    expect(h.kv.keys('session:')).toEqual([])
  })

  it('gives the page a strict policy, with the stylesheet named by its hash', async () => {
    const h = harness()
    const back = await finish(h, await begin(h))
    const html = await back.text()
    const policy = back.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    expect(policy).toContain(`style-src 'sha256-${await sha256Base64(style)}'`)
    expect(html).not.toContain('<script')
    expect(back.headers.get('referrer-policy')).toBe('no-referrer')
    expect(back.headers.get('x-content-type-options')).toBe('nosniff')
    expect(back.headers.get('cache-control')).toBe('no-store')
  })

  it('sends the browser back to the app with the code in the fragment, never the attempt', async () => {
    for (const returnTo of [
      `${APP_ORIGIN}/selfmp3/settings?tab=cloud`,
      'http://localhost:4600/settings/cloud',
      'http://127.0.0.1:8123/',
      // Chrome's address for the browser extension, which launchWebAuthFlow watches for.
      `${EXTENSION_RETURN}/`,
    ]) {
      const h = harness()
      const started = await begin(h, `&return=${encodeURIComponent(returnTo)}`)
      const back = await finish(h, started)
      expect(back.status).toBe(302)
      const location = back.headers.get('location') ?? ''
      const code = (await signInCodeFrom(back)) ?? ''
      expect(location).toBe(`${returnTo}#signin-code=${code}`)
      expect(location).not.toContain(started.attempt)
      expect(back.headers.get('referrer-policy')).toBe('no-referrer')
      expect(back.headers.get('cache-control')).toBe('no-store')
      // And the code it carries claims the session.
      expect((await claimed(h, started.attempt, code)).status).toBe('signed-in')
    }
  })

  it('refuses a state that was changed, made elsewhere or is too old, and writes nothing', async () => {
    const h = harness()
    const expired = async (state: string, started: Started) => {
      const code = h.google.code(idTokenClaims(ME, started.nonce, h.clock), started.challenge)
      const response = await h.call(`/v1/auth/callback?state=${state}&code=${code}`)
      expect(response.status).toBe(400)
      expect(await response.text()).toMatch(/This sign-in has expired/)
    }

    const started = await begin(h, `&return=${encodeURIComponent(`${APP_ORIGIN}/selfmp3/`)}`)
    const [payload = '', mac = ''] = started.state.split('.')
    // A new return address, with the old signature.
    const redirected = toBase64Url(
      utf8(JSON.stringify({ ...statePayload(started.state), returnTo: 'https://evil.example/' })),
    )
    await expired(`${redirected}.${mac}`, started)
    // The old payload, with a signature one character off.
    await expired(`${payload}.${mac.startsWith('A') ? 'B' : 'A'}${mac.slice(1)}`, started)
    await expired(`${payload}.`, started)
    await expired('', started)
    await expired('not-a-state', started)

    // One made by a doorman with another SEAL_KEY.
    const elsewhere = harness()
    elsewhere.env.SEAL_KEY = toBase64(new Uint8Array(32).fill(7))
    const foreign = await begin(elsewhere)
    await expired(foreign.state, foreign)

    // One that is more than ten minutes old.
    const late = await begin(h)
    h.clock.now += 10 * 60_000 + 1
    await expired(late.state, late)

    expect(h.kv.writes).toBe(0)
  })

  it('gives Google the PKCE verifier for the challenge it was shown', async () => {
    const h = harness()
    const started = await begin(h)
    expect((await finish(h, started)).status).toBe(200)
    const verifier = h.google.exchanges[0]?.get('code_verifier') ?? ''
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier)))
    expect(toBase64Url(digest)).toBe(started.challenge)
  })

  it('cannot use a code Google issued for another sign-in', async () => {
    const h = harness()
    const first = await begin(h)
    const second = await begin(h)
    // A code meant for the first sign-in, brought back with the second's state.
    const code = h.google.code(idTokenClaims(ME, second.nonce, h.clock), first.challenge)
    const response = await h.call(`/v1/auth/callback?state=${second.state}&code=${code}`)
    expect(response.status).toBe(502)
    expect(h.kv.writes).toBe(0)
  })

  it('says so when the person cancels at Google', async () => {
    const h = harness()
    const { state } = await begin(h)
    const response = await h.call(`/v1/auth/callback?state=${state}&error=access_denied`)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Google did not sign you in (access_denied).')
    expect(h.kv.writes).toBe(0)
  })

  it('does not repeat an error it does not recognise', async () => {
    const h = harness()
    const { state } = await begin(h)
    const response = await h.call(
      `/v1/auth/callback?state=${state}&error=${encodeURIComponent('<b>Call 555-0100</b>')}`,
    )
    const html = await response.text()
    expect(html).toContain('Google did not sign you in.')
    expect(html).not.toContain('555-0100')
  })

  it.each([
    ['meant for another app', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['issued for another sign-in', { nonce: 'a-different-nonce' }],
    ['with no nonce', { nonce: undefined }],
    ['for an address Google has not verified', { email_verified: false }],
    ['with no word on verification', { email_verified: undefined }],
    ['not from Google', { iss: 'https://accounts.evil.example' }],
    ['already expired', { exp: Math.floor(Date.parse('2026-09-11T11:59:00Z') / 1000) }],
  ])('writes nothing for an ID token %s', async (_why, change) => {
    const h = harness()
    const started = await begin(h)
    const response = await finish(h, started, ME, change)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Google could not finish signing you in.')
    expect(h.kv.writes).toBe(0)
    expect(await claimed(h, started.attempt)).toEqual({ status: 'pending' })
    expect(h.logs.map(line => line.message)).toEqual(['a sign-in failed'])
  })

  it('writes nothing when Google will not trade the code', async () => {
    const h = harness()
    const started = await begin(h)
    h.google.refuse = true
    expect((await finish(h, started)).status).toBe(502)
    expect(h.kv.writes).toBe(0)
  })

  it('turns away a Google account that is not on the list, writing nothing', async () => {
    const h = harness()
    const started = await begin(h)
    const response = await finish(h, started, {
      ...ME,
      sub: '999',
      email: '"<b>stranger</b>"@example.com',
    })
    expect(response.status).toBe(403)
    const html = await response.text()
    expect(html).toContain('is not allowed on this self.mp3')
    expect(html).toContain('&quot;&lt;b&gt;stranger&lt;/b&gt;&quot;@example.com')
    expect(html).not.toContain('<b>stranger')
    expect(html).not.toContain('class="code"')
    expect(h.kv.writes).toBe(0)
  })

  it('turns everyone away when the list was emptied during the sign-in', async () => {
    const h = harness()
    const started = await begin(h)
    h.env.ALLOWED_EMAILS = ''
    const response = await finish(h, started)
    expect(response.status).toBe(403)
    expect(await response.text()).toMatch(/Nobody can sign in yet/)
    expect(h.kv.writes).toBe(0)
  })

  it('compares addresses without regard to case', async () => {
    const h = harness()
    // The list says Friend@Example.com.
    const token = await h.signIn({ sub: '2', email: 'friend@example.com' })
    expect((await h.call('/v1/me', { token })).status).toBe(200)
  })

  it('lets any Google account in when the list says *', async () => {
    for (const list of ['*', ' * ', 'me@example.com, *']) {
      const h = harness()
      h.env.ALLOWED_EMAILS = list
      const token = await h.signIn({ sub: '9', email: 'stranger@example.org' })
      expect((await h.call('/v1/me', { token })).status).toBe(200)
    }
  })

  it('does not read * as part of an address', async () => {
    const h = harness()
    h.env.ALLOWED_EMAILS = '*@example.com'
    const started = await begin(h)
    const response = await finish(h, started, { ...ME, sub: '9', email: 'stranger@example.com' })
    expect(response.status).toBe(403)
    expect(await response.text()).toMatch(/Not allowed/)
    expect(h.kv.writes).toBe(0)
  })
})

describe('claiming', () => {
  it('says pending, then code, then hands the session over for the right code, once', async () => {
    const h = harness()
    const started = await begin(h)
    expect(await claimed(h, started.attempt)).toEqual({ status: 'pending' })

    const code = (await signInCodeFrom(await finish(h, started))) ?? ''
    expect(await claimed(h, started.attempt)).toEqual({ status: 'code' })

    const result = await claimed(h, started.attempt, code)
    if (result.status !== 'signed-in') throw new Error('expected a session')
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.me).toEqual({
      email: ME.email,
      name: ME.name,
      picture: ME.picture,
      storage: null,
    })
    const me = await h.call('/v1/me', { token: result.token })
    expect(DoormanMeSchema.parse(await me.json()).email).toBe(ME.email)

    // Once only: the attempt is gone.
    expect(await refused(await claim(h, started.attempt, code))).toEqual(WRONG_CODE)
    expect(await claimed(h, started.attempt)).toEqual({ status: 'pending' })
  })

  it('takes the code however it is typed back', async () => {
    for (const typed of [
      (code: string) => code.toLowerCase(),
      (code: string) => formatSignInCode(code),
      (code: string) => ` ${code.slice(0, 2)} ${code.slice(2, 6)}-${code.slice(6)} `,
      // I and L for 1, O for 0, as people read them off a screen.
      (code: string) => code.replace(/1/g, 'l').replace(/0/g, 'O'),
    ]) {
      const h = harness()
      const started = await begin(h)
      const code = (await signInCodeFrom(await finish(h, started))) ?? ''
      const result = await claimed(h, started.attempt, typed(code))
      expect(result.status).toBe('signed-in')
    }
  })

  it('ends the attempt at the first wrong code', async () => {
    const h = harness()
    const started = await begin(h)
    const code = (await signInCodeFrom(await finish(h, started))) ?? ''

    expect(await refused(await claim(h, started.attempt, otherCode(code)))).toEqual(WRONG_CODE)
    // The right code is no good now either.
    expect(await refused(await claim(h, started.attempt, code))).toEqual(WRONG_CODE)
    expect(await claimed(h, started.attempt)).toEqual({ status: 'pending' })
    expect(h.kv.keys()).toEqual([])
  })

  it('refuses a code for an attempt there is none of, and writes nothing for it', async () => {
    const h = harness()
    const writes = h.kv.writes
    expect(await refused(await claim(h, newAttempt(), '4F7K2QXM'))).toEqual(WRONG_CODE)
    expect(h.kv.writes).toBe(writes)
  })

  it('refuses what is not a code at all, and leaves the attempt as it was', async () => {
    const h = harness()
    const started = await begin(h)
    const code = (await signInCodeFrom(await finish(h, started))) ?? ''
    for (const bad of ['abc', 'ABCDEFGHU', 'UUUUUUUU', 'x'.repeat(40), '']) {
      const response = await claim(h, started.attempt, bad)
      expect(response.status, bad).toBe(400)
    }
    expect((await claimed(h, started.attempt, code)).status).toBe('signed-in')
  })

  it('checks the list again before making the session', async () => {
    const h = harness()
    const started = await begin(h)
    const code = (await signInCodeFrom(await finish(h, started))) ?? ''
    h.env.ALLOWED_EMAILS = 'friend@example.com'
    const body = await refused(await claim(h, started.attempt, code))
    expect(body.code).toBe('forbidden')
    expect(h.kv.keys()).toEqual([])
  })

  it('lasts ten minutes', async () => {
    const h = harness()
    const started = await begin(h)
    const code = (await signInCodeFrom(await finish(h, started))) ?? ''
    h.clock.now += 10 * 60_000 + 1
    expect(await claimed(h, started.attempt)).toEqual({ status: 'pending' })
    expect(await refused(await claim(h, started.attempt, code))).toEqual(WRONG_CODE)
  })

  it('wants a real attempt, as JSON', async () => {
    const h = harness()
    expect((await h.call('/v1/auth/claim', { json: { attempt: 'nope' } })).status).toBe(400)
    expect((await h.call('/v1/auth/claim', { json: {} })).status).toBe(400)
    const text = await h.call('/v1/auth/claim', {
      body: JSON.stringify({ attempt: newAttempt() }),
      headers: { 'content-type': 'text/plain' },
    })
    expect(text.status).toBe(415)
    const broken = await h.call('/v1/auth/claim', {
      body: '{"attempt":',
      headers: { 'content-type': 'application/json' },
    })
    expect(broken.status).toBe(400)
    expect(ErrorBodySchema.parse(await broken.json()).code).toBe('bad_request')
  })

  it('keeps only the hash of a session, for 180 days', async () => {
    const h = harness()
    const token = await h.signIn()
    const sessions = h.kv.dump().filter(entry => entry.key.startsWith('session:'))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.key).toBe(`session:${await sha256Hex(token)}`)
    expect(sessions[0]?.ttlSeconds).toBe(180 * 24 * 60 * 60)
    for (const { value } of h.kv.dump()) expect(value).not.toContain(token)
    expect(JSON.parse(sessions[0]?.value ?? '')).toEqual({
      sub: ME.sub,
      email: ME.email,
      name: ME.name,
      picture: ME.picture,
      createdAt: '2026-09-11T12:00:00.000Z',
    })
    expect(h.kv.keys('attempt:')).toEqual([])
  })

  it('costs three KV writes for a whole sign-in, and nothing to use afterwards', async () => {
    const h = harness()
    const token = await h.signIn()
    expect(h.kv.writes).toBe(3)
    await h.call('/v1/me', { token })
    h.clock.now += 5 * 60_000
    await h.call('/v1/me', { token })
    expect(h.kv.writes).toBe(3)
  })
})

describe('a sign-in link someone else made', () => {
  it('gives them nothing, even when the person they sent it to signs in with it', async () => {
    const h = harness()
    // The attacker makes an attempt, and gets the victim to open its start link.
    const attackersAttempt = newAttempt()
    const victims = await begin(h, '', attackersAttempt)
    const shown = await finish(h, victims)
    const code = (await signInCodeFrom(shown)) ?? ''
    expect(code).not.toBe('')

    // The attacker sees that the victim has signed in…
    expect(await claimed(h, attackersAttempt)).toEqual({ status: 'code' })
    // …but not the code, and one guess ends the attempt.
    expect(await refused(await claim(h, attackersAttempt, otherCode(code)))).toEqual(WRONG_CODE)
    expect(await refused(await claim(h, attackersAttempt, code))).toEqual(WRONG_CODE)

    expect(h.kv.keys('session:')).toEqual([])
    expect(h.kv.dump()).toEqual([])
  })

  it('sends the code only to the app’s own address, where the attacker is not', async () => {
    const h = harness()
    const attackersAttempt = newAttempt()
    const victims = await begin(
      h,
      `&return=${encodeURIComponent('https://evil.example/collect')}`,
      attackersAttempt,
    )
    const shown = await finish(h, victims)
    // The foreign return address was dropped: the code stays on the doorman's page.
    expect(shown.status).toBe(200)
    expect(shown.headers.get('location')).toBeNull()
    expect(await claimed(h, attackersAttempt)).toEqual({ status: 'code' })
    expect(await refused(await claim(h, attackersAttempt, '2222-2222'))).toEqual(WRONG_CODE)
    expect(h.kv.keys('session:')).toEqual([])
  })
})

describe('sessions', () => {
  it('are required, and must be real', async () => {
    const h = harness()
    await h.signIn()
    for (const headers of [
      {},
      { authorization: 'Bearer' },
      { authorization: 'Basic bWU6cGFzcw==' },
      { authorization: 'Bearer not-a-token' },
      { authorization: `Bearer ${'A'.repeat(43)}` },
    ]) {
      const response = await h.call('/v1/me', { headers })
      expect(response.status).toBe(401)
      expect(ErrorBodySchema.parse(await response.json())).toEqual({
        error: 'sign in first',
        code: 'unauthorized',
      })
    }
  })

  it('end when the device signs out', async () => {
    const h = harness()
    const token = await h.signIn()
    const other = await h.signIn()
    expect((await h.call('/v1/me', { token })).status).toBe(200)

    const out = await h.call('/v1/auth/signout', { method: 'POST', token })
    expect(out.status).toBe(204)
    expect((await h.call('/v1/me', { token })).status).toBe(401)
    expect(h.kv.keys(`session:${await sha256Hex(token)}`)).toEqual([])
    // Another device's session is its own.
    expect((await h.call('/v1/me', { token: other })).status).toBe(200)
    // Signing out again is not a session any more.
    expect((await h.call('/v1/auth/signout', { method: 'POST', token })).status).toBe(401)
  })

  it('cost no KV write to sign out of with a made-up token', async () => {
    const h = harness()
    const writes = h.kv.writes
    const response = await h.call('/v1/auth/signout', { method: 'POST', token: 'B'.repeat(43) })
    expect(response.status).toBe(401)
    expect(h.kv.writes).toBe(writes)
  })

  it('are refused while their address is off the list, and back when it is on again', async () => {
    const h = harness()
    const token = await h.signIn({ sub: '2', email: 'friend@example.com' })
    h.env.ALLOWED_EMAILS = 'me@example.com'
    const refusedNow = await h.call('/v1/me', { token })
    expect(refusedNow.status).toBe(401)
    expect(ErrorBodySchema.parse(await refusedNow.json()).error).toMatch(/no longer allowed/)
    h.env.ALLOWED_EMAILS = 'me@example.com, friend@example.com'
    expect((await h.call('/v1/me', { token })).status).toBe(200)
    h.env.ALLOWED_EMAILS = '*'
    expect((await h.call('/v1/me', { token })).status).toBe(200)
  })

  it('expire after 180 days', async () => {
    const h = harness()
    const token = await h.signIn()
    h.clock.now += 179 * 24 * 60 * 60_000
    expect((await h.call('/v1/me', { token })).status).toBe(200)
    h.clock.now += 2 * 24 * 60 * 60_000
    expect((await h.call('/v1/me', { token })).status).toBe(401)
  })
})

describe('signing out everywhere', () => {
  it('ends every session the account has, for good, with one KV write', async () => {
    const h = harness()
    const phone = await h.signIn()
    h.clock.now += 1000
    const lost = await h.signIn()
    const friend = await h.signIn({ sub: '2', email: 'friend@example.com' })
    h.clock.now += 1000

    const writes = h.kv.writes
    const response = await h.call('/v1/auth/signout-everywhere', { method: 'POST', token: phone })
    expect(response.status).toBe(204)
    expect(h.kv.writes).toBe(writes + 1)

    for (const token of [phone, lost]) {
      const refusedNow = await h.call('/v1/me', { token })
      expect(refusedNow.status).toBe(401)
      expect(ErrorBodySchema.parse(await refusedNow.json()).error).toMatch(/signed out everywhere/)
    }
    // Only that account's sessions.
    expect((await h.call('/v1/me', { token: friend })).status).toBe(200)
    // Putting the address back on the list, or waiting, brings nothing back.
    h.clock.now += 24 * 60 * 60_000
    expect((await h.call('/v1/me', { token: lost })).status).toBe(401)
    // A sign-in afterwards is a session like any other.
    h.clock.now += 1000
    const fresh = await h.signIn()
    expect((await h.call('/v1/me', { token: fresh })).status).toBe(200)
  })

  it('reaches another Worker instance within the minute', async () => {
    const h = harness()
    const kept = await h.signIn()
    h.clock.now += 1000
    const elsewhere = harness()
    elsewhere.env.KV = h.kv
    const call = (token: string) =>
      elsewhere.doorman.fetch(
        new Request(`${DOORMAN_ORIGIN}/v1/me`, { headers: { authorization: `Bearer ${token}` } }),
        elsewhere.env,
      )
    // The other instance has the session, and "never signed out", in hand.
    expect((await call(kept)).status).toBe(200)

    await h.call('/v1/auth/signout-everywhere', { method: 'POST', token: kept })
    // Within the minute it remembers, the other instance has not heard yet:
    // the price of not reading KV on every request.
    expect((await call(kept)).status).toBe(200)
    elsewhere.clock.now = h.clock.now + 61_000
    h.clock.now += 61_000
    expect((await call(kept)).status).toBe(401)
  })

  it('needs a session of its own', async () => {
    const h = harness()
    expect((await h.call('/v1/auth/signout-everywhere', { method: 'POST' })).status).toBe(401)
    expect(h.kv.writes).toBe(0)
  })
})

describe('coming back to a native app', () => {
  it('goes back to the app when the return is its own scheme', async () => {
    const h = harness()
    const started = await begin(h, `&return=${encodeURIComponent('selfmp3://signin')}`)
    const back = await finish(h, started)
    expect(back.status).toBe(302)
    const code = (await signInCodeFrom(back)) ?? ''
    // The code rides in the fragment, exactly as it does for the web app —
    // and the attempt does not, which is what makes this safe on a phone.
    expect(back.headers.get('location')).toBe(`selfmp3://signin#signin-code=${code}`)
    expect(back.headers.get('location')).not.toContain(started.attempt)
    expect((await claimed(h, started.attempt, code)).status).toBe('signed-in')
  })

  it("drops a scheme that is not the app's, and still shows the code", async () => {
    const h = harness()
    const started = await begin(h, `&return=${encodeURIComponent('evilapp://collect')}`)
    const back = await finish(h, started)
    expect(back.status).toBe(200)
    expect(back.headers.get('location')).toBeNull()
  })
})

describe('appSchemes', () => {
  it('defaults to the app this doorman was written for', () => {
    expect(appSchemes(undefined).has('selfmp3:')).toBe(true)
  })

  it('takes a scheme however it is written', () => {
    for (const written of ['selfmp3', 'selfmp3:', 'selfmp3://', 'SELFMP3']) {
      expect(appSchemes(written).has('selfmp3:')).toBe(true)
    }
  })

  it('ignores anything that could not be one', () => {
    const schemes = appSchemes('ok, not a scheme, 9bad')
    expect(schemes.has('ok:')).toBe(true)
    expect(schemes.has('9bad:')).toBe(false)
    expect(schemes.has('not a scheme:')).toBe(false)
  })
})
