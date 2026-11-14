import { DoormanDriveStartedSchema, DoormanMeSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { utf8 } from './encoding.js'
import { B2_HOST } from './fakeBucket.js'
import { APP_ORIGIN, ME, harness, type Harness } from './fakes.js'

/**
 * Connecting Google Drive: the trip to Google and back, what is kept at the
 * end of it, and everything that must connect nothing.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SONG = `audio/${'ab'.repeat(32)}.m4a`
const BACK = `${APP_ORIGIN}/selfmp3/storage`

async function storage(h: Harness, token: string) {
  return DoormanMeSchema.parse(await (await h.call('/v1/me', { token })).json()).storage
}

async function signedIn(): Promise<{ h: Harness; token: string }> {
  const h = harness()
  return { h, token: await h.signIn() }
}

describe('POST /v1/storage/drive', () => {
  it('needs a session', async () => {
    const h = harness()
    expect((await h.call('/v1/storage/drive', { json: {} })).status).toBe(401)
  })

  it('sends the device to Google for Drive’s own-files scope, writing nothing', async () => {
    const { h, token } = await signedIn()
    const writes = h.kv.writes
    const response = await h.call('/v1/storage/drive', { token, json: { returnTo: BACK } })
    expect(response.status).toBe(200)
    const url = new URL(DoormanDriveStartedSchema.parse(await response.json()).url)

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe(`openid email ${DRIVE_SCOPE}`)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('login_hint')).toBe(ME.email)
    // The address a sign-in comes back to: the OAuth client needs no second one.
    expect(url.searchParams.get('redirect_uri')).toBe('https://doorman.example/v1/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(h.kv.writes).toBe(writes)
  })

  it('leaves signing in asking for nothing more than who you are', async () => {
    const h = harness()
    const start = await h.call(`/v1/auth/start?attempt=${'a'.repeat(32)}`)
    const url = new URL(start.headers.get('location') ?? '')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.has('access_type')).toBe(false)
  })
})

describe('coming back from Google', () => {
  it('makes the folder, writes format.json, and keeps the account’s storage in one KV write', async () => {
    const { h, token } = await signedIn()
    const writes = h.kv.writes
    const back = await h.connectDrive(token, { returnTo: BACK })
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe(`${BACK}#storage=connected`)
    expect(h.kv.writes).toBe(writes + 1)

    const [root] = h.drive.roots()
    expect(root?.name).toBe('self.mp3')
    expect(await storage(h, token)).toEqual({ kind: 'drive', folder: root?.id })
    const inside = [...h.drive.files.values()]
      .filter(file => file.parents.includes(root?.id ?? ''))
      .map(file => file.name)
      .sort()
    expect(inside).toEqual(['audio', 'covers', 'format.json', 'log', 'lyrics', 'snapshots'])
    expect(JSON.parse(h.drive.text(root?.id ?? '', 'format.json') ?? '')).toMatchObject({
      app: 'self.mp3',
      format: 1,
    })
  })

  it('never sends Google’s token to a device, and seals it in KV', async () => {
    const { h, token } = await signedIn()
    await h.connectDrive(token)
    const [refreshToken = ''] = [...h.google.refreshTokens]
    expect(refreshToken).not.toBe('')
    expect(await (await h.call('/v1/me', { token })).text()).not.toContain(refreshToken)
    for (const entry of h.kv.dump()) expect(entry.value).not.toContain(refreshToken)
  })

  it('shows a page of its own when the device gave nowhere to come back to', async () => {
    const { h, token } = await signedIn()
    const back = await h.connectDrive(token)
    expect(back.status).toBe(200)
    expect(await back.text()).toContain('Google Drive is connected')
  })

  it('comes back only to the app’s own addresses', async () => {
    const { h, token } = await signedIn()
    const back = await h.connectDrive(token, { returnTo: 'https://evil.example/storage' })
    expect(back.status).toBe(200)
    expect(back.headers.get('location')).toBeNull()
  })

  it('finds the same folder again, library and all, after disconnecting', async () => {
    const { h, token } = await signedIn()
    await h.connectDrive(token)
    const before = await storage(h, token)
    await h.call(`/v1/files/${SONG}`, {
      method: 'PUT',
      token,
      headers: { 'content-type': 'audio/mp4', 'content-length': '3' },
      body: new Blob([utf8('abc')]).stream(),
    })
    expect((await h.call('/v1/storage', { method: 'DELETE', token })).status).toBe(200)
    expect(await storage(h, token)).toBeNull()

    await h.connectDrive(token)
    expect(await storage(h, token)).toEqual(before)
    expect(h.drive.roots()).toHaveLength(1)
    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('abc')
  })

  it('refuses another Google account than the one signed in', async () => {
    const { h, token } = await signedIn()
    const back = await h.connectDrive(token, {
      returnTo: BACK,
      as: { sub: '999', email: 'someone@example.com' },
    })
    expect(back.headers.get('location')).toBe(`${BACK}#storage-refused=other-account`)
    expect(await storage(h, token)).toBeNull()
    expect(h.drive.files.size).toBe(0)
  })

  it('says so when the Drive box was left unticked', async () => {
    const { h, token } = await signedIn()
    const back = await h.connectDrive(token, { returnTo: BACK, grant: { scope: 'openid email' } })
    expect(back.headers.get('location')).toBe(`${BACK}#storage-refused=unticked`)
    expect(await storage(h, token)).toBeNull()

    const page = await h.connectDrive(token, { grant: { scope: 'openid email' } })
    expect(page.status).toBe(400)
    expect(await page.text()).toContain('Tick the one that lets self.mp3 keep its own files')
  })

  it('says so when Google’s page was cancelled', async () => {
    const { h, token } = await signedIn()
    const started = await h.call('/v1/storage/drive', { token, json: { returnTo: BACK } })
    const url = new URL(DoormanDriveStartedSchema.parse(await started.json()).url)
    const state = url.searchParams.get('state') ?? ''
    const back = await h.call(`/v1/auth/callback?state=${state}&error=access_denied`)
    expect(back.headers.get('location')).toBe(`${BACK}#storage-refused=cancelled`)
  })

  it('connects nothing without a refresh token, or when Google refuses the code', async () => {
    const { h, token } = await signedIn()
    const none = await h.connectDrive(token, { returnTo: BACK, grant: { refreshToken: null } })
    expect(none.headers.get('location')).toBe(`${BACK}#storage-refused=failed`)
    h.google.refuse = true
    const refused = await h.connectDrive(token, { returnTo: BACK })
    expect(refused.headers.get('location')).toBe(`${BACK}#storage-refused=failed`)
    expect(await storage(h, token)).toBeNull()
    expect(h.logs.map(line => line.message)).toContain('connecting Google Drive failed')
  })

  it('does not take a sign-in’s state for a Drive one, or the other way round', async () => {
    const { h, token } = await signedIn()
    const start = await h.call(`/v1/auth/start?attempt=${'b'.repeat(32)}`)
    const signIn = new URL(start.headers.get('location') ?? '')
    const code = h.google.code({}, signIn.searchParams.get('code_challenge') ?? '', {})
    // A sign-in's trip, answered with a Drive grant: it is still only a sign-in.
    await h.call(
      `/v1/auth/callback?state=${signIn.searchParams.get('state')}&code=${encodeURIComponent(code)}`,
    )
    expect(await storage(h, token)).toBeNull()
    expect(h.drive.files.size).toBe(0)
  })
})

describe('one library, one store', () => {
  it('replaces a bucket with Google Drive, and Drive with a bucket, handing Google its token back', async () => {
    const { h, token } = await signedIn()
    expect((await h.connect(token)).status).toBe(200)
    expect((await storage(h, token))?.kind).toBe('bucket')

    await h.connectDrive(token)
    expect((await storage(h, token))?.kind).toBe('drive')
    const [refreshToken = ''] = [...h.google.refreshTokens]

    expect((await h.connect(token)).status).toBe(200)
    await h.settle()
    expect((await storage(h, token))?.kind).toBe('bucket')
    expect(h.google.revoked).toEqual([refreshToken])
    // The bucket is the one being read now.
    h.bucket.put('selfmp3/' + SONG, 'from the bucket')
    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('from the bucket')
    expect(h.outside.at(-1)?.url.host).toBe(B2_HOST)
  })

  it('hands the token back on disconnect, and keeps the files', async () => {
    const { h, token } = await signedIn()
    await h.connectDrive(token)
    const files = h.drive.files.size
    await h.call('/v1/storage', { method: 'DELETE', token })
    await h.settle()
    expect(h.google.revoked).toHaveLength(1)
    expect(h.google.refreshTokens.size).toBe(0)
    expect(h.drive.files.size).toBe(files)
    const list = await h.call('/v1/list', { token })
    expect(ErrorBodySchema.parse(await list.json()).code).toBe('no_storage')
  })

  it('hands nothing back when Drive is connected a second time: Google would end the new access too', async () => {
    const { h, token } = await signedIn()
    await h.connectDrive(token)
    await h.connectDrive(token)
    await h.settle()
    expect(h.google.revoked).toEqual([])
    // An hour on, the instance's access token has run out and the new refresh token is used.
    h.clock.now += 61 * 60_000
    expect((await h.call('/v1/list?prefix=audio/', { token })).status).toBe(200)
  })

  it('keeps a bucket’s sealed record exactly as it was before there was Drive', async () => {
    const { h, token } = await signedIn()
    await h.connect(token)
    // What an account connected before this build has in KV: no `kind` at all.
    const other = harness()
    const theirs = await other.signIn()
    for (const key of h.kv.keys('bucket:')) {
      const value = h.kv.dump().find(entry => entry.key === key)?.value ?? ''
      await other.kv.put(key, value)
    }
    other.clock.now += 61_000
    expect(await storage(other, theirs)).toMatchObject({ kind: 'bucket', bucket: 'my-music' })
  })
})

describe('a server’s grant', () => {
  it('may not say where the account’s library is kept, or end its storage', async () => {
    const { h, token } = await signedIn()
    await h.connectDrive(token)
    const made = await h.call('/v1/grants', {
      token,
      json: { server: 'https://server.example', name: 'Pi' },
    })
    const grant = (await made.json()) as { token: string }

    expect((await h.call('/v1/storage/drive', { token: grant.token, json: {} })).status).toBe(403)
    expect((await h.connect(grant.token)).status).toBe(403)
    expect((await h.connectBackblaze(grant.token)).status).toBe(403)
    expect((await h.call('/v1/storage', { method: 'DELETE', token: grant.token })).status).toBe(403)
    await h.settle()
    expect(h.google.revoked).toEqual([])
    expect((await storage(h, token))?.kind).toBe('drive')
  })
})

describe('a server working in a Google Drive', () => {
  it('reads the account’s files with its grant, as it does a bucket’s', async () => {
    const { h, token } = await signedIn()
    await h.connectDrive(token)
    await h.call(`/v1/files/${SONG}`, {
      method: 'PUT',
      token,
      headers: { 'content-type': 'audio/mp4', 'content-length': '3' },
      body: new Blob([utf8('abc')]).stream(),
    })
    // A server's grant reads the account's storage the way a device does.
    const made = await h.call('/v1/grants', {
      token,
      json: { server: 'https://server.example', name: 'Pi' },
    })
    const grant = (await made.json()) as { token: string }
    expect(await (await h.call(`/v1/files/${SONG}`, { token: grant.token })).text()).toBe('abc')
  })
})
