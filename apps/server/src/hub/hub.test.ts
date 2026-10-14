import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  CloudServerSchema,
  CloudStatusSchema,
  DoormanGrantsSchema,
  DoormanMeSchema,
  HealthSchema,
  HUB_LIBRARY_HEADER,
  HubStatusSchema,
  LyricsSearchResponseSchema,
} from '@selfmp3/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from '../../../doorman/src/fakes.js'
import {
  askAddress,
  candidates,
  reachServer,
} from '../../../../packages/client/src/connection/reach.js'
import type { CloudPlatform, DeviceStore } from '../../../../packages/replica/src/platform.js'
import { createCloudSession, type CloudSession } from '../../../../packages/replica/src/session.js'
import { createSharedServer } from '../../../../packages/replica/src/sharedServer.js'
import { loadConfig, type Config } from '../config.js'
import { createContainer } from '../container.js'
import { createLogger } from '../logger.js'
import { createHubApp } from './app.js'
import { Hub } from './hub.js'

/**
 * A server working for several accounts, end to end
 * (docs/features/shared-server.md): the real doorman, over HTTP, in front of
 * its look-alike of a Backblaze bucket, and the hub over HTTP in front of
 * that. Nothing between a device's request and the bucket is faked but the
 * bucket itself.
 */

const variables = [
  'SELFMP3_DATA_DIR',
  'SELFMP3_LIBRARY_DIR',
  'SELFMP3_LOG_LEVEL',
  'SELFMP3_AUTH_TOKEN',
  'SELFMP3_CLOUD_DIR',
  'SELFMP3_DOORMAN_URL',
  'SELFMP3_SOUND',
  'SELFMP3_PUBLIC_URL',
  'SELFMP3_HOST',
] as const

let root = ''
let doorman: Harness
let doormanServer: http.Server
let doormanUrl = ''
const saved = new Map<string, string | undefined>()
const open: { hub: Hub; server: http.Server }[] = []

beforeEach(async () => {
  for (const name of variables) saved.set(name, process.env[name])
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-hub-'))
  doorman = harness()
  doormanServer = http.createServer((req, res) => void serveDoorman(req, res))
  await new Promise<void>(resolve => doormanServer.listen(0, '127.0.0.1', resolve))
  doormanUrl = `http://127.0.0.1:${(doormanServer.address() as AddressInfo).port}`

  process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
  process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
  process.env['SELFMP3_LOG_LEVEL'] = 'silent'
  process.env['SELFMP3_DOORMAN_URL'] = doormanUrl
  process.env['SELFMP3_SOUND'] = 'false'
  process.env['SELFMP3_PUBLIC_URL'] = 'https://pi.example.ts.net'
  process.env['SELFMP3_HOST'] = '127.0.0.1'
  delete process.env['SELFMP3_AUTH_TOKEN']
  delete process.env['SELFMP3_CLOUD_DIR']
})

afterEach(async () => {
  for (const { hub, server } of open.splice(0)) {
    hub.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  await new Promise<void>(resolve => doormanServer.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

/** The doorman's own `fetch`, behind a real socket the server's client can reach. */
async function serveDoorman(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value)
  }
  const method = req.method ?? 'GET'
  const response = await doorman.doorman.fetch(
    new Request(`${doormanUrl}${req.url ?? '/'}`, {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
    }),
    doorman.env,
  )
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}

/** A hub over HTTP, on `port` when it is to come back where it was. */
async function startHub(port = 0): Promise<{ hub: Hub; url: string; config: Config }> {
  const config = loadConfig()
  const hub = new Hub(config, createLogger('silent'))
  hub.start()
  const server = http.createServer(createHubApp(hub))
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  open.push({ hub, server })
  return { hub, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, config }
}

async function join(url: string, session: string) {
  const response = await fetch(`${url}/api/hub/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session}` },
  })
  return { status: response.status, body: (await response.json()) as unknown }
}

async function health(url: string, token: string) {
  const response = await fetch(`${url}/api/health?token=${encodeURIComponent(token)}`)
  return HealthSchema.parse(await response.json())
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** The newest snapshot under a prefix of the look-alike bucket, as text. */
function newestSnapshot(prefix: string): string | null {
  const keys = [...doorman.bucket.objects.keys()]
    .filter(key => key.startsWith(`${prefix}/snapshots/`))
    .sort()
  const key = keys.at(-1)
  if (!key) return null
  const object = doorman.bucket.objects.get(key)!
  const bytes = Buffer.from(object.body)
  return (bytes[0] === 0x1f ? zlib.gunzipSync(bytes) : bytes).toString('utf8')
}

/** A signed-in account with a bucket of its own, under its own folder of the look-alike. */
async function account(sub: string, email: string, prefix: string): Promise<string> {
  const session = await doorman.signIn({ sub, email })
  const connected = await doorman.connect(session, { prefix })
  expect(connected.status).toBe(200)
  return session
}

describe('a server working for several accounts', () => {
  it('works for each account that joins, in its own bucket, behind its own token', async () => {
    const { hub, url } = await startHub()
    const mine = await account('1', 'me@example.com', 'mine')
    const theirs = await account('2', 'friend@example.com', 'theirs')

    const joined = await join(url, mine)
    expect(joined.status).toBe(200)
    const me = CloudServerSchema.parse(joined.body)
    expect(me.addresses).toContain('https://pi.example.ts.net')
    const friend = CloudServerSchema.parse((await join(url, theirs)).body)
    expect(friend.token).not.toBe(me.token)
    expect(hub.workspaces()).toHaveLength(2)

    // Each library answers to its own token, and to nobody else's.
    expect((await health(url, me.token!)).songCount).toBe(0)
    const stranger = await fetch(`${url}/api/library`, {
      headers: { Authorization: 'Bearer not-anyones' },
    })
    expect(stranger.status).toBe(401)
    expect((await fetch(`${url}/api/library`)).status).toBe(401)
    expect(HealthSchema.parse(await (await fetch(`${url}/api/health`)).json()).songCount).toBe(
      undefined,
    )

    // Each publishes to its own bucket, naming this server and its own token.
    await until(() => newestSnapshot('mine')?.includes(me.token!) ?? false, 'my snapshot')
    await until(() => newestSnapshot('theirs')?.includes(friend.token!) ?? false, 'theirs')
    expect(newestSnapshot('mine')).not.toContain(friend.token)
    expect(newestSnapshot('mine')).toContain('https://pi.example.ts.net')

    // Joining again is the same library.
    expect(CloudServerSchema.parse((await join(url, mine)).body).token).toBe(me.token)
    expect(hub.workspaces()).toHaveLength(2)

    // The account sees the grant it gave, by the server's address.
    const listed = await doorman.call('/v1/grants', { token: mine })
    expect(DoormanGrantsSchema.parse(await listed.json()).grants.map(g => g.server)).toEqual([
      'https://pi.example.ts.net',
    ])
  })

  it('keeps each library’s lyrics to its own search', async () => {
    const { hub, url } = await startHub()
    const me = CloudServerSchema.parse(
      (await join(url, await account('1', 'me@example.com', 'mine'))).body,
    )
    const friend = CloudServerSchema.parse(
      (await join(url, await account('2', 'friend@example.com', 'theirs'))).body,
    )
    const mine = hub.workspaces().find(w => w.container.config.authToken === me.token)!.container
    const songId = mine.songs.insert({
      path: 'monster.m4a',
      title: 'Monster',
      artist: 'YOASOBI',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 1,
      sizeBytes: 1,
      mime: 'audio/mp4',
      mtimeMs: 0,
      hasArt: false,
      artExt: null,
      lyricsKind: 'plain',
      sourceUrl: null,
    })
    mine.lyricsIndex.index(songId, 'running into the night')

    const search = async (token: string) => {
      const response = await fetch(`${url}/api/lyrics/search?q=night`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return LyricsSearchResponseSchema.parse(await response.json()).hits
    }
    expect((await search(me.token!)).map(hit => [hit.songId, hit.title])).toEqual([
      [songId, 'Monster'],
    ])
    expect(await search(friend.token!)).toEqual([])
  })

  it('refuses a session the doorman does not know, and an account with no bucket', async () => {
    const { url } = await startHub()
    expect((await join(url, 'x'.repeat(43))).status).toBe(401)
    const bare = await doorman.signIn({ sub: '3', email: 'friend@example.com' })
    const refused = await join(url, bare)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(refused.body)).toMatch(/storage/)
  })

  it('opens the same libraries after a restart, behind the same tokens', async () => {
    const first = await startHub()
    const mine = await account('1', 'me@example.com', 'mine')
    const me = CloudServerSchema.parse((await join(first.url, mine)).body)
    await until(() => newestSnapshot('mine')?.includes(me.token!) ?? false, 'my snapshot')
    const { hub, server } = open.pop()!
    hub.close()
    await new Promise<void>(resolve => server.close(() => resolve()))

    const second = await startHub()
    expect(second.hub.workspaces()).toHaveLength(1)
    expect((await health(second.url, me.token!)).songCount).toBe(0)
    // Still the server the snapshots name, so a device finds it before the next one.
    expect((await health(second.url, me.token!)).serverId).toBe(me.id)
  })

  it('lets a library go when its account takes the grant back', async () => {
    const { hub, url, config } = await startHub()
    const mine = await account('1', 'me@example.com', 'mine')
    const me = CloudServerSchema.parse((await join(url, mine)).body)
    await until(() => newestSnapshot('mine')?.includes(me.token!) ?? false, 'my snapshot')
    const [workspace] = hub.workspaces()
    const folder = path.join(config.dataDir, 'accounts', workspace!.entry!.id)
    expect(fs.existsSync(folder)).toBe(true)

    const grants = DoormanGrantsSchema.parse(
      await (await doorman.call('/v1/grants', { token: mine })).json(),
    ).grants
    const removed = await doorman.call(`/v1/grants/${grants[0]!.id}`, {
      method: 'DELETE',
      token: mine,
    })
    expect(removed.status).toBe(204)

    // Its next pass is refused, and the library goes.
    void workspace!.container.cloudSync.syncNow({ verify: true })
    await until(() => hub.workspaces().length === 0, 'the library to be let go')
    expect(fs.existsSync(folder)).toBe(false)
    expect((await fetch(`${url}/api/library?token=${me.token}`)).status).toBe(401)
  })

  it('joins afresh an account whose grant was taken back a moment ago', async () => {
    const { hub, url } = await startHub()
    const mine = await account('1', 'me@example.com', 'mine')
    const before = CloudServerSchema.parse((await join(url, mine)).body)
    const grants = DoormanGrantsSchema.parse(
      await (await doorman.call('/v1/grants', { token: mine })).json(),
    ).grants
    await doorman.call(`/v1/grants/${grants[0]!.id}`, { method: 'DELETE', token: mine })

    // Joined again by hand before the workspace looked at its bucket: not the
    // library about to be let go, but a new one behind a new grant.
    const after = CloudServerSchema.parse((await join(url, mine)).body)
    expect(after.token).not.toBe(before.token)
    expect(hub.workspaces()).toHaveLength(1)
    expect((await fetch(`${url}/api/library?token=${before.token}`)).status).toBe(401)
    expect((await fetch(`${url}/api/library?token=${after.token}`)).status).toBe(200)
    const now = DoormanGrantsSchema.parse(
      await (await doorman.call('/v1/grants', { token: mine })).json(),
    ).grants
    expect(now).toHaveLength(1)
  })

  it('says whom it works for to its own machine, which can name one with no token', async () => {
    const { url } = await startHub()
    const listed = async (headers: Record<string, string> = {}) => {
      const response = await fetch(`${url}/api/hub`, { headers })
      return { status: response.status, body: (await response.json()) as unknown }
    }
    const cloud = (headers: Record<string, string> = {}) => fetch(`${url}/api/cloud`, { headers })
    const said = async (response: Response) => ((await response.json()) as { error: string }).error

    expect(HubStatusSchema.parse((await listed()).body).workspaces).toEqual([])
    const nobody = await cloud()
    expect(nobody.status).toBe(401)
    expect(await said(nobody)).toBe('this server works for no libraries yet')

    await join(url, await account('1', 'me@example.com', 'mine'))
    await join(url, await account('2', 'friend@example.com', 'theirs'))
    const { workspaces } = HubStatusSchema.parse((await listed()).body)
    expect(workspaces.map(({ email, songs }) => ({ email, songs }))).toEqual([
      { email: 'me@example.com', songs: 0 },
      { email: 'friend@example.com', songs: 0 },
    ])
    const friend = workspaces[1]!
    expect(friend.id).toMatch(/^[0-9a-f]{16}$/)

    // Two libraries and nothing to say which: no telling whose was meant.
    const unnamed = await cloud()
    expect(unnamed.status).toBe(401)
    expect(await said(unnamed)).toBe('this server works for 2 libraries; say which')

    // Named by id, each answers as its own.
    const named = await cloud({ [HUB_LIBRARY_HEADER]: friend.id })
    expect(named.status).toBe(200)
    expect(CloudStatusSchema.parse(await named.json()).account?.email).toBe('friend@example.com')
    const unknown = await cloud({ [HUB_LIBRARY_HEADER]: '0123456789abcdef' })
    expect(unknown.status).toBe(404)

    // From anywhere else neither the list nor the name counts for anything.
    const elsewhere = { 'X-Forwarded-For': '203.0.113.9' }
    expect((await listed(elsewhere)).status).toBe(403)
    expect((await cloud({ ...elsewhere, [HUB_LIBRARY_HEADER]: friend.id })).status).toBe(401)
  })

  it('lets a device read its library’s cloud state but change it only from its own machine', async () => {
    const { url } = await startHub()
    const me = CloudServerSchema.parse(
      (await join(url, await account('1', 'me@example.com', 'mine'))).body,
    )
    const { workspaces } = HubStatusSchema.parse(await (await fetch(`${url}/api/hub`)).json())
    const id = workspaces[0]!.id

    // A device: its library's token, from another computer.
    const device = { Authorization: `Bearer ${me.token}`, 'X-Forwarded-For': '203.0.113.9' }
    const bucket = {
      endpoint: 'https://s3.example.com',
      bucket: 'elsewhere',
      keyId: 'k',
      applicationKey: 'secret',
    }
    const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
      fetch(`${url}/api/cloud${path}`, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

    expect((await send('GET', '', device)).status).toBe(200)
    expect((await send('GET', '/uids', device)).status).toBe(200)
    for (const [method, path, body] of [
      ['PUT', '', bucket],
      ['DELETE', '', undefined],
      ['POST', '/signin', { attempt: '0'.repeat(32) }],
      ['DELETE', '/signin', undefined],
      ['POST', '/signin/code', { code: 'ABCD-1234' }],
      ['PUT', '/storage', bucket],
      ['POST', '/sync', undefined],
    ] as const) {
      const refused = await send(method, path, device, body)
      expect(refused.status, `${method} /api/cloud${path}`).toBe(403)
    }
    // Still connected: nothing a device sent got through.
    const after = CloudStatusSchema.parse(await (await send('GET', '', device)).json())
    expect(after.connected).toBe(true)
    expect(after.account?.email).toBe('me@example.com')

    // The server's own page, on its own machine, may.
    expect((await send('POST', '/sync', { [HUB_LIBRARY_HEADER]: id })).status).toBe(200)
  })

  it('refuses a data folder holding a library and nothing to say whose', () => {
    // The one library of a server from before it worked for accounts: its
    // database in the data folder itself, and no hub.json.
    const before = loadConfig()
    createContainer(before, { logger: createLogger('silent') }).close()
    expect(fs.existsSync(path.join(before.dataDir, 'selfmp3.db'))).toBe(true)

    expect(() => new Hub(loadConfig(), createLogger('silent'))).toThrow(
      /holds a library \(selfmp3\.db\) and no hub\.json/,
    )
    // Left exactly where it was.
    expect(fs.existsSync(path.join(before.dataDir, 'selfmp3.db'))).toBe(true)
    expect(fs.existsSync(path.join(before.dataDir, 'hub.json'))).toBe(false)
  })
})

/** The shared server's public address, which a test reaches at the hub's real one. */
const PUBLIC = 'https://pi.example.ts.net'

describe('which server a device takes', () => {
  /** An address asked as the app and the extension ask it. */
  const probe = askAddress.bind(null, fetch)

  /*
   * 2026-10-14: the Pi publishes `http://localhost:4600` among its addresses,
   * and on the Mac a development server answers there. A device racing the
   * snapshot's addresses took it, and every request after was refused: the
   * Pi's token, at a server holding another library.
   */
  it('passes over a development server answering at one of the addresses', async () => {
    const pi = await startHub()
    const mine = await account('1', 'me@example.com', 'mine')
    const me = CloudServerSchema.parse((await join(pi.url, mine)).body)
    await until(() => newestSnapshot('mine')?.includes(me.token!) ?? false, 'my snapshot')
    const published = CloudServerSchema.parse(
      (JSON.parse(newestSnapshot('mine')!) as { server: unknown }).server,
    )
    expect(published.id).toBe(me.id)
    // Said to anyone: the id is which server this is, not whose library.
    expect(HealthSchema.parse(await (await fetch(`${pi.url}/api/health`)).json()).serverId).toBe(
      me.id,
    )

    // `npm run dev`: its own folders, and a folder for a bucket.
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'dev-data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'dev-library')
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'
    delete process.env['SELFMP3_PUBLIC_URL']
    const dev = await startHub()
    const devHealth = HealthSchema.parse(await (await fetch(`${dev.url}/api/health`)).json())
    expect(devHealth.serverId).toBeDefined()
    expect(devHealth.serverId).not.toBe(me.id)
    // What a device that took it met from then on.
    expect((await fetch(`${dev.url}/api/library?token=${me.token}`)).status).toBe(401)

    // Where the development server is the only one answering, nothing is taken.
    expect(await reachServer(candidates({ ...published, addresses: [dev.url] }), probe)).toBeNull()
    // Beside the real one, the real one is.
    const found = await reachServer(
      candidates({ ...published, addresses: [dev.url, pi.url] }),
      probe,
    )
    if (!found || found === 'refused') throw new Error(`found ${found}`)
    expect(found.baseUrl).toBe(pi.url)
    expect((await fetch(`${found.baseUrl}/api/library?token=${found.token}`)).status).toBe(200)
  })

  /** A device: its own storage, and the shared server at `PUBLIC`, which is `url` here. */
  function device(url: string) {
    const values = new Map<string, unknown>()
    const store: DeviceStore = {
      read: key => Promise.resolve(values.get(key) ?? null),
      write: (key, value) => {
        values.set(key, value)
        return Promise.resolve()
      },
      remove: key => {
        values.delete(key)
        return Promise.resolve()
      },
      update: (key, change) => {
        const next = change(values.get(key) ?? null)
        values.set(key, next)
        return Promise.resolve(next)
      },
    }
    const platform = {
      doormanUrl,
      sharedServerUrl: PUBLIC,
      store,
      fetch: (to: string, init?: RequestInit) => fetch(to.replace(PUBLIC, url), init),
    } as unknown as CloudPlatform
    return createSharedServer(platform, createCloudSession(platform))
  }

  /** What the device asks an address with: the public one reaches the hub. */
  const askingAt = (url: string) => (to: string, init?: RequestInit) =>
    fetch(to.replace(PUBLIC, url), init)

  async function sessionOf(token: string): Promise<CloudSession> {
    const me = DoormanMeSchema.parse(await (await doorman.call('/v1/me', { token })).json())
    return { doormanUrl, token, me }
  }

  /** The server the newest snapshot names, reachable at its public address alone. */
  function namedIn(prefix: string) {
    const snapshot = JSON.parse(newestSnapshot(prefix)!) as { server: unknown }
    return CloudServerSchema.parse(snapshot.server)
  }

  /*
   * 2026-10-14: Settings › Account › Computers › Remove took the shared
   * server's grant back. The server let the library go — and the bucket's
   * newest snapshot went on naming it, with a token it no longer took, since
   * the grant it would have written a new one with was the thing removed.
   * Every device kept choosing it, and every import was a 401.
   */
  it('passes over a server that let the library go, though the bucket still names it', async () => {
    const pi = await startHub()
    const cloud = await sessionOf(await account('1', 'me@example.com', 'mine'))
    const phone = device(pi.url)
    const laptop = device(pi.url)

    // The phone joins by itself; the snapshot names the server.
    const joined = await phone.automatic(cloud, null)
    expect(joined?.addresses).toContain(PUBLIC)
    await until(() => newestSnapshot('mine')?.includes(joined!.token!) ?? false, 'my snapshot')
    const named = { ...namedIn('mine'), addresses: [PUBLIC] }
    expect(await reachServer(candidates(named), askAddress.bind(null, askingAt(pi.url)))).toEqual(
      candidates(named)[0],
    )
    expect(await laptop.automatic(cloud, named)).toEqual(named)

    // Remove, on the phone: passed over there at once, and not joined again.
    const [grant] = (await phone.grants(cloud)).grants
    await phone.removeGrant(cloud, grant!.id, named)
    expect(await phone.automatic(cloud, named)).toBeNull()

    // The server notices at its next look, and lets the library go.
    void pi.hub.workspaces()[0]!.container.cloudSync.syncNow({ verify: true })
    await until(() => pi.hub.workspaces().length === 0, 'the library to be let go')

    // The bug: the bucket still names it, it still answers as itself, and it
    // refuses the token.
    expect(namedIn('mine').token).toBe(named.token)
    expect((await fetch(`${pi.url}/api/library?token=${named.token}`)).status).toBe(401)

    // What a device's look finds now.
    const found = await reachServer(candidates(named), askAddress.bind(null, askingAt(pi.url)))
    expect(found).toBe('refused')

    // The laptop, told so: no grant is left for it, so it was taken back on
    // another device, and the laptop leaves it too rather than undo the Remove.
    expect(await laptop.refused(cloud, named.token!, named)).toBeNull()
    expect(await laptop.automatic(cloud, named)).toBeNull()
    expect(pi.hub.workspaces()).toHaveLength(0)
    expect((await phone.grants(cloud)).grants).toEqual([])
  })

  it('joins again a server that lost the library some other way', async () => {
    const first = await startHub()
    const cloud = await sessionOf(await account('1', 'me@example.com', 'mine'))
    const phone = device(first.url)
    const joined = await phone.automatic(cloud, null)
    await until(() => newestSnapshot('mine')?.includes(joined!.token!) ?? false, 'my snapshot')
    const named = { ...namedIn('mine'), addresses: [PUBLIC] }

    // hub.json deleted, and the workspaces with it (shared-server.md says
    // every account joins again from its next device); the grant is still the
    // account's, and the server is still the one the snapshot names.
    const { hub, server } = open.pop()!
    hub.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(path.join(first.config.dataDir, 'hub.json'))
    fs.rmSync(path.join(first.config.dataDir, 'accounts'), { recursive: true, force: true })
    const second = await startHub()
    const laptop = device(second.url)

    const found = await reachServer(candidates(named), askAddress.bind(null, askingAt(second.url)))
    expect(found).toBe('refused')
    const again = await laptop.refused(cloud, named.token!, named)
    expect(again?.token).toBeDefined()
    expect(again?.token).not.toBe(named.token)
    expect(second.hub.workspaces()).toHaveLength(1)
    // Until the next snapshot names it, the one joined is the one used.
    expect(await laptop.automatic(cloud, named)).toEqual(again)
  })

  /*
   * 2026-10-14: a server named itself at random on its first boot. One that
   * lost its whole data folder (a Pi rebuilt on a new SD card) came back at
   * the same addresses under a new name, every device took it for some other
   * server, and none joined it again.
   */
  it('joins again a server rebuilt with an empty data folder, at the same address', async () => {
    const first = await startHub()
    const port = Number(new URL(first.url).port)
    const cloud = await sessionOf(await account('1', 'me@example.com', 'mine'))
    const phone = device(first.url)
    const joined = await phone.automatic(cloud, null)
    await until(() => newestSnapshot('mine')?.includes(joined!.token!) ?? false, 'my snapshot')
    const named = namedIn('mine')

    // Everything the server kept is gone: hub.json, the workspaces, its name.
    const { hub, server } = open.pop()!
    hub.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(first.config.dataDir, { recursive: true, force: true })
    fs.rmSync(first.config.libraryDir, { recursive: true, force: true })
    const second = await startHub(port)
    expect(second.url).toBe(first.url)
    const said = HealthSchema.parse(await (await fetch(`${second.url}/api/health`)).json())
    expect(said.serverId).toBe(named.id)

    // A development server on the same machine, with the public address in
    // its settings too: on a folder bucket, it is still its own server.
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'dev-data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'dev-library')
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'
    const dev = await startHub()
    const devSaid = HealthSchema.parse(await (await fetch(`${dev.url}/api/health`)).json())
    expect(devSaid.serverId).not.toBe(named.id)

    // A device's look, with the development server where `localhost` is: the
    // server the snapshot names answers as itself and refuses the old token.
    const asked = askAddress.bind(null, askingAt(second.url))
    const addresses = [dev.url, second.url, PUBLIC]
    expect(await reachServer(candidates({ ...named, addresses }), asked)).toBe('refused')

    // A device that never removed it joins it again by itself, and takes it.
    const laptop = device(second.url)
    const again = await laptop.refused(cloud, named.token!, named)
    expect(again?.id).toBe(named.id)
    expect(again?.token).not.toBe(named.token)
    const found = await reachServer(candidates({ ...again!, addresses }), asked)
    if (!found || found === 'refused') throw new Error(`found ${found}`)
    expect(found.baseUrl).toBe(second.url)
    expect((await fetch(`${found.baseUrl}/api/library?token=${found.token}`)).status).toBe(200)
    // The phone that joined it first comes to the same library, under one grant.
    expect((await phone.refused(cloud, named.token!, named))?.token).toBe(again!.token)
    expect((await phone.grants(cloud)).grants.map(grant => grant.server)).toEqual([PUBLIC])

    // The library comes back from the bucket, and the bucket names it again.
    await until(() => newestSnapshot('mine')?.includes(again!.token!) ?? false, 'a new snapshot')
    expect(namedIn('mine').id).toBe(named.id)
  })
})
