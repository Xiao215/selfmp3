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
  HealthSchema,
  HUB_LIBRARY_HEADER,
  HubStatusSchema,
  LyricsSearchResponseSchema,
} from '@selfmp3/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from '../../../doorman/src/fakes.js'
import {
  answersAs,
  candidates,
  reachServer,
  type Candidate,
} from '../../../../packages/client/src/connection/reach.js'
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

async function startHub(): Promise<{ hub: Hub; url: string; config: Config }> {
  const config = loadConfig()
  const hub = new Hub(config, createLogger('silent'))
  hub.start()
  const server = http.createServer(createHubApp(hub))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
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
    expect(workspaces.map(({ email, grant, songs }) => ({ email, grant, songs }))).toEqual([
      { email: 'me@example.com', grant: 'granted', songs: 0 },
      { email: 'friend@example.com', grant: 'granted', songs: 0 },
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

  it('makes a library from before into a workspace, keeping its token, then settles its grant', async () => {
    // The one library a server had: signed in through the doorman, in the data folder itself.
    const before = loadConfig()
    const serverSession = await account('1', 'me@example.com', 'mine')
    const container = createContainer(before, { logger: createLogger('silent') })
    const token = container.config.authToken
    container.cloudRepo.saveDoormanSession({
      url: doormanUrl,
      token: serverSession,
      email: 'me@example.com',
      name: null,
      picture: null,
      storage: null,
    })
    container.close()
    fs.writeFileSync(path.join(before.libraryDir, 'waiting.m4a'), 'not really audio')

    const { hub, url, config } = await startHub()
    const [workspace] = hub.workspaces()
    const id = workspace!.entry!.id
    expect(fs.existsSync(path.join(config.dataDir, 'selfmp3.db'))).toBe(false)
    expect(fs.existsSync(path.join(config.dataDir, 'accounts', id, 'selfmp3.db'))).toBe(true)
    expect(fs.existsSync(path.join(config.libraryDir, id, 'waiting.m4a'))).toBe(true)
    expect((await health(url, token)).ok).toBe(true)

    // Settled: the account known, a grant of its own, the old session ended.
    await until(() => hub.workspaces()[0]?.entry?.grant?.id != null, 'the grant to settle')
    expect(hub.workspaces()[0]?.entry?.account).toMatch(/^[0-9a-f]{32}$/)
    await until(
      async () => (await doorman.call('/v1/me', { token: serverSession })).status === 401,
      'the old session to be signed out',
    )
    expect((await health(url, token)).ok).toBe(true)
  })
})

describe('which server a device takes', () => {
  /** `/api/health` at a candidate, as the app and the extension ask it. */
  const probe = async (candidate: Candidate): Promise<boolean> => {
    const response = await fetch(`${candidate.baseUrl}/api/health`)
    return response.ok && answersAs(await response.json(), candidate)
  }

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
    expect(found?.baseUrl).toBe(pi.url)
    expect((await fetch(`${found!.baseUrl}/api/library?token=${found!.token}`)).status).toBe(200)
  })
})
