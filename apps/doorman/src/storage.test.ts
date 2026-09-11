import { CLOUD_FORMAT, DoormanMeSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import {
  APPLICATION_KEY,
  B2_HOST,
  BUCKET,
  KEY_ID,
  ME,
  SEAL_KEY,
  harness,
  type Harness,
} from './fakes.js'

/**
 * Connecting a bucket: the key is tried against the bucket — an S3 look-alike
 * that checks every signature — before anything is kept, with the Mac's rules
 * for format.json and the Mac's words for each way it can go wrong. And the
 * key, once kept, is never seen again outside the Worker.
 */

async function signedIn(): Promise<{ h: Harness; token: string }> {
  const h = harness()
  return { h, token: await h.signIn() }
}

async function me(h: Harness, token: string) {
  const response = await h.call('/v1/me', { token })
  expect(response.status).toBe(200)
  return DoormanMeSchema.parse(await response.json())
}

async function refusal(response: Response): Promise<string> {
  expect(response.status).toBe(422)
  const body = ErrorBodySchema.parse(await response.json())
  expect(body.code).toBe('unprocessable')
  return body.error
}

const FORMAT = {
  app: 'self.mp3',
  format: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  createdBy: 'mac-3f9a1c2e',
}

describe('/v1/me', () => {
  it('says who is signed in, and that there is no bucket yet', async () => {
    const { h, token } = await signedIn()
    expect(await me(h, token)).toEqual({
      email: ME.email,
      name: ME.name,
      picture: ME.picture,
      storage: null,
    })
  })

  it('shows where the bucket is once connected, but never the key', async () => {
    const { h, token } = await signedIn()
    await h.connect(token)
    const response = await h.call('/v1/me', { token })
    const text = await response.text()
    expect(text).not.toContain(APPLICATION_KEY)
    expect(text).not.toContain(KEY_ID)
    expect(DoormanMeSchema.parse(JSON.parse(text)).storage).toEqual({
      endpoint: `https://${B2_HOST}`,
      region: 'us-west-004',
      bucket: BUCKET,
      prefix: 'selfmp3',
      keyIdHint: '004abc…',
    })
  })

  it('is remembered for a minute, so using the library costs no KV reads', async () => {
    const { h, token } = await signedIn()
    await h.connect(token)
    const reads = h.kv.reads
    await h.call('/v1/me', { token })
    await h.call('/v1/list', { token })
    expect(h.kv.reads).toBe(reads)
    h.clock.now += 61_000
    await h.call('/v1/me', { token })
    // The session, the account's last sign-out everywhere, and its bucket.
    expect(h.kv.reads).toBe(reads + 3)
  })
})

describe('connecting a bucket', () => {
  it('writes format.json into a new bucket, reads it back, and seals the key', async () => {
    const { h, token } = await signedIn()
    const response = await h.connect(token)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain(APPLICATION_KEY)
    expect(text).not.toContain(KEY_ID)
    expect(DoormanMeSchema.parse(JSON.parse(text)).storage?.bucket).toBe(BUCKET)

    expect(JSON.parse(h.bucket.text('selfmp3/format.json') ?? '')).toEqual({
      app: 'self.mp3',
      format: CLOUD_FORMAT,
      createdAt: '2026-09-11T12:00:00.000Z',
      createdBy: 'doorman',
    })
    expect(h.bucket.objects.get('selfmp3/format.json')?.contentType).toBe('application/json')
    // Listed, read, written, read back — as the Mac does it.
    expect(h.bucket.requests.map(request => request.method)).toEqual(['GET', 'GET', 'PUT', 'GET'])
    expect(h.bucket.requests[0]?.url.searchParams.get('prefix')).toBe('selfmp3/format.json')

    // Nothing in KV gives the key away: the bucket is sealed, under a key of its own.
    for (const { value } of h.kv.dump()) {
      expect(value).not.toContain(APPLICATION_KEY)
      expect(value).not.toContain(KEY_ID)
    }
    expect(await h.kv.get(`bucket:${ME.sub}`)).toMatch(/^v1:[A-Za-z0-9+/]+=*$/)
  })

  it('is never rewritten by signing in again', async () => {
    const { h, token } = await signedIn()
    await h.connect(token)
    const sealed = await h.kv.get(`bucket:${ME.sub}`)
    const writes = h.kv.writes
    const later = await h.signIn({ name: 'Xiao Z' })
    // The sign-in's own three writes, and none of them the bucket.
    expect(h.kv.writes).toBe(writes + 3)
    expect(await h.kv.get(`bucket:${ME.sub}`)).toBe(sealed)
    const me = DoormanMeSchema.parse(await (await h.call('/v1/me', { token: later })).json())
    expect(me).toMatchObject({ name: 'Xiao Z', storage: { bucket: BUCKET } })
  })

  it('leaves a format.json it understands as it is', async () => {
    const { h, token } = await signedIn()
    h.bucket.put('selfmp3/format.json', JSON.stringify(FORMAT), { contentType: 'application/json' })
    expect((await h.connect(token)).status).toBe(200)
    expect(JSON.parse(h.bucket.text('selfmp3/format.json') ?? '')).toEqual(FORMAT)
    expect(h.bucket.requests.some(request => request.method === 'PUT')).toBe(false)
  })

  it('refuses a bucket set up by a newer self.mp3, and keeps nothing', async () => {
    const { h, token } = await signedIn()
    h.bucket.put('selfmp3/format.json', JSON.stringify({ ...FORMAT, format: CLOUD_FORMAT + 1 }))
    expect(await refusal(await h.connect(token))).toBe(
      `This bucket was set up by a newer version of self.mp3 (format ${CLOUD_FORMAT + 1}). ` +
        'Update the doorman before connecting it.',
    )
    expect((await me(h, token)).storage).toBeNull()
  })

  it('refuses a folder whose format.json is not self.mp3’s', async () => {
    const { h, token } = await signedIn()
    for (const body of ['{"app":"something-else","format":1}', 'not json', 'x'.repeat(70_000)]) {
      h.bucket.put('selfmp3/format.json', body)
      expect(await refusal(await h.connect(token))).toBe(
        'That folder of the bucket has a format.json that is not self.mp3’s. Choose another folder.',
      )
    }
    expect((await me(h, token)).storage).toBeNull()
  })

  it('says the key is wrong, in words, and without repeating it', async () => {
    const { h, token } = await signedIn()
    const wrongId = await refusal(await h.connect(token, { keyId: '004wrongkeyid' }))
    expect(wrongId).toBe(
      'The bucket refused the key (InvalidAccessKeyId). Check the key ID and the application ' +
        `key, and that the key is allowed to use “${BUCKET}”.`,
    )
    const wrongKey = await refusal(
      await h.connect(token, { applicationKey: 'K004-not-the-right-key' }),
    )
    expect(wrongKey).toMatch(/^The bucket refused the key \(SignatureDoesNotMatch\)\./)
    expect(wrongKey).not.toContain('K004-not-the-right-key')
    expect((await me(h, token)).storage).toBeNull()
  })

  it('says when there is no such bucket', async () => {
    const { h, token } = await signedIn()
    expect(await refusal(await h.connect(token, { bucket: 'not-my-bucket' }))).toBe(
      `There is no bucket called “not-my-bucket” at ${B2_HOST}.`,
    )
  })

  it('says when the address cannot be reached', async () => {
    const { h, token } = await signedIn()
    expect(
      await refusal(await h.connect(token, { endpoint: 's3.eu-central-003.backblazeb2.com' })),
    ).toBe('Could not reach s3.eu-central-003.backblazeb2.com.')
  })

  it('says when the key can write but not read', async () => {
    const { h, token } = await signedIn()
    h.bucket.unreadable.add('selfmp3/format.json')
    expect(await refusal(await h.connect(token))).toBe(
      'The key can write to the bucket but not read from it. It needs both.',
    )
    expect((await me(h, token)).storage).toBeNull()
  })

  it('checks what S3 alone would not', async () => {
    const { h, token } = await signedIn()
    expect(await refusal(await h.connect(token, { endpoint: 'not an address' }))).toMatch(
      /not an address/,
    )
    expect(
      await refusal(await h.connect(token, { endpoint: 'https://s3.example.com/my-music' })),
    ).toMatch(/not an address/)
    expect(await refusal(await h.connect(token, { endpoint: `http://${B2_HOST}` }))).toMatch(
      /https/,
    )
    expect(
      await refusal(
        await h.connect(token, { endpoint: 'https://abc123.r2.cloudflarestorage.com' }),
      ),
    ).toBe('Say which region the bucket is in, as its provider names it.')
    expect(await refusal(await h.connect(token, { prefix: 'music/../other' }))).toMatch(/\.\./)
    expect(h.bucket.requests).toEqual([])
  })

  it('refuses a region or a key ID that could not go in a request header', async () => {
    const { h, token } = await signedIn()
    for (const [changes, field] of [
      [{ region: 'US West 004' }, 'region'],
      [{ region: 'us-west-004\r\nx-evil: 1' }, 'region'],
      [{ region: 'r'.repeat(65) }, 'region'],
      [{ keyId: '004 abc' }, 'keyId'],
      [{ keyId: 'clé-004' }, 'keyId'],
      [{ keyId: '004abc\nx' }, 'keyId'],
    ] as const) {
      const response = await h.connect(token, changes)
      expect(response.status, JSON.stringify(changes)).toBe(400)
      const body = ErrorBodySchema.parse(await response.json())
      expect(body.error.startsWith(`${field}: `)).toBe(true)
    }
    expect(h.bucket.requests).toEqual([])
  })

  it('takes a bucket on this computer over http only in development', async () => {
    const { h, token } = await signedIn()
    const local = { endpoint: 'http://127.0.0.1:9000', region: 'us-east-1' }
    expect(await refusal(await h.connect(token, local))).toBe(
      'The endpoint has to be an https:// address.',
    )
    h.env.DEV = 'true'
    // Allowed now; the test's internet has nothing on port 9000, which is the point.
    expect(await refusal(await h.connect(token, local))).toBe('Could not reach 127.0.0.1:9000.')
    // Even in development, only this computer.
    expect(await refusal(await h.connect(token, { endpoint: `http://${B2_HOST}` }))).toBe(
      'The endpoint has to be an https:// address.',
    )
  })

  it('refuses a body that is not a CloudConnect', async () => {
    const { h, token } = await signedIn()
    const response = await h.connect(token, { bucket: 'x' })
    expect(response.status).toBe(400)
    expect(ErrorBodySchema.parse(await response.json()).error).toMatch(/^bucket: /)
    const missing = await h.call('/v1/storage', { method: 'PUT', token, json: {} })
    expect(missing.status).toBe(400)
  })

  it('works at the root of the bucket, and with a region it is given', async () => {
    const { h, token } = await signedIn()
    const response = await h.connect(token, { prefix: '', region: 'us-west-004' })
    expect(response.status).toBe(200)
    expect(h.bucket.objects.has('format.json')).toBe(true)
    expect((await me(h, token)).storage?.prefix).toBe('')
  })

  it('tidies the folder as the Mac does', async () => {
    const { h, token } = await signedIn()
    await h.connect(token, { prefix: '/music/selfmp3' })
    expect((await me(h, token)).storage?.prefix).toBe('music/selfmp3')
    expect(h.bucket.objects.has('music/selfmp3/format.json')).toBe(true)
  })

  it('needs a session', async () => {
    const h = harness()
    const response = await h.call('/v1/storage', { method: 'PUT', json: {} })
    expect(response.status).toBe(401)
  })

  it('says the doorman is not set up when SEAL_KEY is missing or not a key', async () => {
    for (const sealKey of [undefined, 'too-short']) {
      const { h, token } = await signedIn()
      h.env.SEAL_KEY = sealKey
      const response = await h.connect(token)
      expect(response.status).toBe(500)
      const body = ErrorBodySchema.parse(await response.json())
      expect(body).toMatchObject({ code: 'not_set_up' })
      expect(body.error).toMatch(/SEAL_KEY/)
      expect(body.error).not.toContain('too-short')
    }
  })
})

describe('forgetting a bucket', () => {
  it('forgets it, and leaves the bucket alone', async () => {
    const { h, token } = await signedIn()
    await h.connect(token)
    const response = await h.call('/v1/storage', { method: 'DELETE', token })
    expect(response.status).toBe(200)
    expect(DoormanMeSchema.parse(await response.json()).storage).toBeNull()
    expect(h.bucket.objects.has('selfmp3/format.json')).toBe(true)
    const list = await h.call('/v1/list', { token })
    expect(list.status).toBe(409)
    expect(ErrorBodySchema.parse(await list.json())).toEqual({
      error: 'connect your bucket first',
      code: 'no_storage',
    })
  })
})

describe('a sealed bucket', () => {
  it('opens only for the account it belongs to', async () => {
    const h = harness()
    const mine = await h.signIn()
    await h.connect(mine)
    const theirs = await h.signIn({ sub: '2', email: 'friend@example.com' })

    // Someone with access to KV copies my sealed bucket onto my friend's account.
    await h.kv.put('bucket:2', (await h.kv.get(`bucket:${ME.sub}`)) ?? '')
    h.clock.now += 61_000

    expect((await me(h, theirs)).storage).toBeNull()
    expect((await h.call('/v1/list', { token: theirs })).status).toBe(409)
    expect(h.logs.map(line => line.message)).toContain(
      'an account’s bucket could not be opened; treating it as not connected',
    )
    // Mine still opens.
    expect((await me(h, mine)).storage?.bucket).toBe(BUCKET)
  })

  it('opens again after the Worker restarts, with the same SEAL_KEY', async () => {
    const h = harness()
    const token = await h.signIn()
    await h.connect(token)
    // A fresh instance: nothing cached, only KV and the secret.
    const fresh = harness()
    const kv = h.kv
    fresh.env.KV = kv
    expect(fresh.env.SEAL_KEY).toBe(SEAL_KEY)
    const response = await fresh.doorman.fetch(
      new Request('https://doorman.example/v1/me', {
        headers: { authorization: `Bearer ${token}` },
      }),
      fresh.env,
    )
    expect(DoormanMeSchema.parse(await response.json()).storage?.bucket).toBe(BUCKET)
  })
})
