import { DoormanClaimResultSchema, DoormanMeSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { sha256Base64, sha256Hex } from './encoding.js'
import {
  APP_ORIGIN,
  CLIENT_ID,
  DOORMAN_ORIGIN,
  ME,
  harness,
  newAttempt,
  type Harness,
} from './fakes.js'

/**
 * Signing in, end to end: the device's start link, Google's round trip (a fake
 * token endpoint that issues whatever ID token the test asks for), the page the
 * browser lands on, and the device claiming its session.
 */

/** Open the start link, as the device would, and read where it sends the browser. */
async function begin(h: Harness, query = '') {
  const attempt = newAttempt()
  const start = await h.call(`/v1/auth/start?attempt=${attempt}${query}`)
  const google = new URL(start.headers.get('location') ?? 'about:blank')
  return {
    attempt,
    start,
    google,
    state: google.searchParams.get('state') ?? '',
    nonce: google.searchParams.get('nonce') ?? '',
  }
}

/** The claims Google would put in an ID token for this sign-in. */
function claims(h: Harness, nonce: string, changes: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: ME.sub,
    email: ME.email,
    email_verified: true,
    name: ME.name,
    picture: ME.picture,
    nonce,
    iat: Math.floor(h.clock.now / 1000),
    exp: Math.floor(h.clock.now / 1000) + 3600,
    ...changes,
  }
}

/** Google sending the browser back, with a code for an ID token carrying these claims. */
function finish(h: Harness, state: string, tokenClaims: Record<string, unknown>) {
  const code = h.google.code(tokenClaims)
  return h.call(`/v1/auth/callback?state=${state}&code=${encodeURIComponent(code)}`)
}

async function claim(h: Harness, attempt: string) {
  const response = await h.call('/v1/auth/claim', { json: { attempt } })
  expect(response.status).toBe(200)
  return DoormanClaimResultSchema.parse(await response.json())
}

function nothingMade(h: Harness): void {
  expect(h.kv.keys('session:')).toEqual([])
  expect(h.kv.keys('account:')).toEqual([])
  expect(h.kv.keys('attempt:')).toEqual([])
}

describe('starting a sign-in', () => {
  it('sends the browser to Google with a state and nonce it keeps for ten minutes', async () => {
    const h = harness()
    const returnTo = `${APP_ORIGIN}/selfmp3/settings?tab=cloud`
    const { attempt, start, google, state, nonce } = await begin(
      h,
      `&return=${encodeURIComponent(returnTo)}`,
    )

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
      prompt: 'select_account',
    })
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(nonce).not.toBe(state)

    // The attempt stays with the doorman: Google never sees it.
    expect(google.toString()).not.toContain(attempt)
    const [stored] = h.kv.dump()
    expect(stored?.key).toBe(`state:${state}`)
    expect(stored?.ttlSeconds).toBe(600)
    expect(JSON.parse(stored?.value ?? '')).toEqual({ attempt, returnTo, nonce })
  })

  it('ignores a return address that is not the app’s own', async () => {
    const h = harness()
    for (const address of [
      'https://evil.example/selfmp3/',
      'https://xiao215.github.io.evil.example/',
      'javascript:alert(1)',
      '//evil.example/',
      'not a url',
    ]) {
      const { state, start } = await begin(h, `&return=${encodeURIComponent(address)}`)
      expect(start.status).toBe(302)
      expect(JSON.parse((await h.kv.get(`state:${state}`)) ?? '')).toMatchObject({
        returnTo: null,
      })
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
    expect(await h.call('/v1/auth/start').then(r => r.status)).toBe(400)
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

  it('says the doorman is not set up when it has no Google client', async () => {
    const h = harness()
    h.env.GOOGLE_CLIENT_ID = ''
    const response = await h.call(`/v1/auth/start?attempt=${newAttempt()}`)
    expect(response.status).toBe(500)
    expect(await response.text()).toMatch(/Not set up yet/)
  })
})

describe('coming back from Google', () => {
  it('signs in, and the device claims its session exactly once', async () => {
    const h = harness()
    const returnTo = `${APP_ORIGIN}/selfmp3/`
    const { attempt, state, nonce } = await begin(h, `&return=${encodeURIComponent(returnTo)}`)

    // The device asks before Google has sent the browser back.
    expect(await claim(h, attempt)).toEqual({ status: 'pending' })

    const back = await finish(h, state, claims(h, nonce))
    expect(back.status).toBe(200)
    const html = await back.text()
    expect(html).toContain('Signed in as me@example.com.')
    expect(html).toContain('You can go back to self.mp3.')
    const next = `${returnTo}#signin=${attempt}`
    expect(html).toContain(`<meta http-equiv="refresh" content="2; url=${next}">`)
    expect(html).toContain(`<a href="${next}">`)

    // Google was asked with the same address the browser was sent from.
    const form = h.google.exchanges[0]
    expect(form?.get('redirect_uri')).toBe(`${DOORMAN_ORIGIN}/v1/auth/callback`)
    expect(form?.get('grant_type')).toBe('authorization_code')

    const signedIn = await claim(h, attempt)
    if (signedIn.status !== 'signed-in') throw new Error('expected a session')
    expect(signedIn.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(signedIn.me).toEqual({
      email: ME.email,
      name: ME.name,
      picture: ME.picture,
      storage: null,
    })

    // Once only.
    expect(await claim(h, attempt)).toEqual({ status: 'pending' })

    // And the session works.
    const me = await h.call('/v1/me', { token: signedIn.token })
    expect(me.status).toBe(200)
    expect(DoormanMeSchema.parse(await me.json()).email).toBe(ME.email)
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
  })

  it('costs six KV writes for a whole sign-in, and nothing to use afterwards', async () => {
    const h = harness()
    const token = await h.signIn()
    expect(h.kv.writes).toBe(6)
    await h.call('/v1/me', { token })
    h.clock.now += 5 * 60_000
    await h.call('/v1/me', { token })
    expect(h.kv.writes).toBe(6)
  })

  it('ends on the doorman’s own page when there is nowhere to go back to', async () => {
    const h = harness()
    const { state, nonce } = await begin(h)
    const back = await finish(h, state, claims(h, nonce))
    const html = await back.text()
    expect(html).toContain('Signed in as me@example.com.')
    expect(html).not.toContain('http-equiv="refresh"')
    expect(html).not.toContain('<a ')
  })

  it('gives the page a strict policy, with the stylesheet named by its hash', async () => {
    const h = harness()
    const { state, nonce } = await begin(h)
    const back = await finish(h, state, claims(h, nonce))
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

  it('uses each state once, and forgets it after ten minutes', async () => {
    const h = harness()
    const first = await begin(h)
    expect((await finish(h, first.state, claims(h, first.nonce))).status).toBe(200)
    const again = await finish(h, first.state, claims(h, first.nonce))
    expect(again.status).toBe(400)
    expect(await again.text()).toMatch(/This sign-in has expired/)

    const late = await begin(h)
    h.clock.now += 11 * 60_000
    const expired = await finish(h, late.state, claims(h, late.nonce))
    expect(expired.status).toBe(400)
    expect(await expired.text()).toMatch(/This sign-in has expired/)
  })

  it('says a sign-in has expired when the state is missing or made up', async () => {
    const h = harness()
    for (const query of ['', '?code=x', '?state=abc&code=x', `?state=${'a'.repeat(43)}&code=x`]) {
      const response = await h.call(`/v1/auth/callback${query}`)
      expect(response.status).toBe(400)
      expect(await response.text()).toMatch(/This sign-in has expired/)
    }
    nothingMade(h)
  })

  it('says so when the person cancels at Google', async () => {
    const h = harness()
    const { state } = await begin(h)
    const response = await h.call(`/v1/auth/callback?state=${state}&error=access_denied`)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Google did not sign you in (access_denied).')
    expect(h.kv.keys('state:')).toEqual([])
    nothingMade(h)
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
  ])('makes no session from an ID token %s', async (_why, change) => {
    const h = harness()
    const { attempt, state, nonce } = await begin(h)
    const response = await finish(h, state, claims(h, nonce, change))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Google could not finish signing you in.')
    nothingMade(h)
    expect(await claim(h, attempt)).toEqual({ status: 'pending' })
  })

  it('makes no session when Google will not trade the code', async () => {
    const h = harness()
    const { state, nonce } = await begin(h)
    h.google.refuse = true
    const response = await finish(h, state, claims(h, nonce))
    expect(response.status).toBe(502)
    nothingMade(h)
  })

  it('turns away a Google account that is not on the list, and makes nothing for it', async () => {
    const h = harness()
    const { attempt, state, nonce } = await begin(h)
    const response = await finish(
      h,
      state,
      claims(h, nonce, { email: '"<b>stranger</b>"@example.com', sub: '999' }),
    )
    expect(response.status).toBe(403)
    const html = await response.text()
    expect(html).toContain('is not allowed on this self.mp3')
    expect(html).toContain('&quot;&lt;b&gt;stranger&lt;/b&gt;&quot;@example.com')
    expect(html).not.toContain('<b>stranger')
    nothingMade(h)
    expect(await claim(h, attempt)).toEqual({ status: 'pending' })
  })

  it('turns everyone away when the list was emptied during the sign-in', async () => {
    const h = harness()
    const { state, nonce } = await begin(h)
    h.env.ALLOWED_EMAILS = ''
    const response = await finish(h, state, claims(h, nonce))
    expect(response.status).toBe(403)
    expect(await response.text()).toMatch(/Nobody can sign in yet/)
    nothingMade(h)
  })

  it('compares addresses without regard to case', async () => {
    const h = harness()
    // The list says Friend@Example.com.
    const token = await h.signIn({ sub: '2', email: 'friend@example.com' })
    expect((await h.call('/v1/me', { token })).status).toBe(200)
  })

  it('keeps a sign-in’s account up to date, and its bucket', async () => {
    const h = harness()
    const token = await h.signIn()
    expect((await h.connect(token)).status).toBe(200)
    const later = await h.signIn({ name: 'Xiao Z', picture: 'https://example.com/new.png' })
    const me = DoormanMeSchema.parse(await (await h.call('/v1/me', { token: later })).json())
    expect(me).toMatchObject({ name: 'Xiao Z', picture: 'https://example.com/new.png' })
    expect(me.storage?.bucket).toBe('my-music')
  })
})

describe('claiming', () => {
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

  it('end at once for someone taken off the list', async () => {
    const h = harness()
    const token = await h.signIn({ sub: '2', email: 'friend@example.com' })
    h.env.ALLOWED_EMAILS = 'me@example.com'
    const response = await h.call('/v1/me', { token })
    expect(response.status).toBe(401)
    expect(ErrorBodySchema.parse(await response.json()).error).toMatch(/no longer allowed/)
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
