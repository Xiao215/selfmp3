import { IOS_INSTALL_LINK, IphoneAddedSchema, IphoneListSchema, iphoneKey } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { DOORMAN_ORIGIN, harness, type Harness } from './fakes.js'

/** A friend's iPhone, from the install page to the build (device.ts). */

const UDID = '00008140-00094D0436F3001C'
const KEY = 'k'.repeat(64)

/** What iOS posts: the plist, inside a signature's binary bytes. */
function answer(udid: string): Uint8Array {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>PRODUCT</key><string>iPhone17,1</string>
<key>UDID</key>
<string>${udid}</string>
</dict></plist>`
  const noise = new Uint8Array([0x30, 0x82, 0x0f, 0xff, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7])
  const text = new TextEncoder().encode(plist)
  const out = new Uint8Array(noise.length * 2 + text.length)
  out.set(noise)
  out.set(text, noise.length)
  out.set(noise, noise.length + text.length)
  return out
}

const ask = (h: Harness, udid = UDID, name = 'Mei') =>
  h.call(`/v1/device?name=${encodeURIComponent(name)}`, { method: 'POST', body: answer(udid) })

/** The release, answering for the build on it and the iPhones it carries. */
async function release(h: Harness, udids: string[]): Promise<void> {
  const devices = await Promise.all(udids.map(iphoneKey))
  h.elsewhere.set('github.com', () =>
    Response.json({ version: '1.0.0', build: 7, commit: 'abc', publishedAt: 'now', devices }),
  )
}

/** GitHub's API, taking the iPhone workflow's start and answering with `status`. */
function github(h: Harness, status = 204): Request[] {
  const seen: Request[] = []
  h.elsewhere.set('api.github.com', request => {
    seen.push(request)
    return new Response(null, { status })
  })
  return seen
}

function owner(h: Harness): { token: string } {
  h.env.ADMIN_TOKEN = KEY
  return { token: KEY }
}

async function list(h: Harness) {
  const response = await h.call('/v1/iphones', owner(h))
  expect(response.status).toBe(200)
  return IphoneListSchema.parse(await response.json()).iphones
}

describe("a friend's iPhone", () => {
  it('asks for its ID with a profile that comes back with the name it was given', async () => {
    const response = await harness().call('/v1/device?name=Mei%20%26%20co')
    expect(response.headers.get('content-type')).toBe('application/x-apple-aspen-config')
    const profile = await response.text()
    expect(profile).toContain('<string>Profile Service</string>')
    expect(profile).toContain(`<string>${DOORMAN_ORIGIN}/v1/device?name=Mei%20%26%20co</string>`)
  })

  it('waits on the list once it has answered, and its page says so', async () => {
    const h = harness()
    await release(h, [])
    const posted = await ask(h)
    expect(posted.status).toBe(301)
    expect(posted.headers.get('location')).toBe(`${DOORMAN_ORIGIN}/v1/device/${UDID}`)

    expect(await list(h)).toEqual([
      expect.objectContaining({ udid: UDID, name: 'Mei', state: 'waiting' }),
    ])
    const page = await (await h.call(`/v1/device/${UDID}`)).text()
    expect(page).toContain('Thanks, Mei.')
    expect(page).toContain('waiting to be added')
  })

  it('is added by the owner, which starts the build, and its page says one is being made', async () => {
    const h = harness()
    await release(h, [])
    const started = github(h)
    h.env.GITHUB_TOKEN = 'ghp_test'
    await ask(h)

    const response = await h.call(`/v1/iphones/${UDID}`, { ...owner(h), method: 'PUT' })
    const body = IphoneAddedSchema.parse(await response.json())
    expect(body.build).toBe('started')
    expect(body.iphone.state).toBe('added')
    expect(started).toHaveLength(1)
    expect(started[0]?.url).toBe(
      'https://api.github.com/repos/Xiao215/selfmp3/actions/workflows/ios.yml/dispatches',
    )
    expect(started[0]?.headers.get('authorization')).toBe('Bearer ghp_test')

    expect(await (await h.call(`/v1/device/${UDID}`)).text()).toContain('being made')
  })

  it('offers Install once the build on the release carries it', async () => {
    const h = harness()
    await ask(h)
    await h.call(`/v1/iphones/${UDID}`, { ...owner(h), method: 'PUT' })
    await release(h, [UDID.toLowerCase()])
    const page = await (await h.call(`/v1/device/${UDID}`)).text()
    expect(page).toContain('Ready to install')
    expect(page).toContain(IOS_INSTALL_LINK.replace(/&/g, '&amp;'))
  })

  it('is still added when no build can be started, and says why', async () => {
    const h = harness()
    await ask(h)
    const unset = await h.call(`/v1/iphones/${UDID}`, { ...owner(h), method: 'PUT' })
    expect(IphoneAddedSchema.parse(await unset.json()).build).toBe('not-set-up')

    h.env.GITHUB_TOKEN = 'ghp_test'
    github(h, 404)
    const refused = await h.call(`/v1/iphones/${UDID}`, { ...owner(h), method: 'PUT' })
    expect(IphoneAddedSchema.parse(await refused.json()).build).toBe('failed')
    expect((await list(h))[0]?.state).toBe('added')
  })

  it('is dropped by the owner', async () => {
    const h = harness()
    await ask(h)
    expect((await h.call(`/v1/iphones/${UDID}`, { ...owner(h), method: 'DELETE' })).status).toBe(
      204,
    )
    expect(await list(h)).toEqual([])
  })

  it('is kept once however often it asks, with the newest name', async () => {
    const h = harness()
    await ask(h, UDID, 'Mei')
    h.clock.now += 5 * 60_000
    await ask(h, UDID.toLowerCase(), 'Mei L')
    expect(await list(h)).toEqual([expect.objectContaining({ udid: UDID, name: 'Mei L' })])
  })

  it('shows the list to the owner only', async () => {
    const h = harness()
    await ask(h)
    expect((await h.call('/v1/iphones')).status).toBe(401)
    const friend = await h.signIn({ sub: 'friend', email: 'friend@example.com' })
    expect((await h.call('/v1/iphones', { token: friend })).status).toBe(403)
    expect((await h.call(`/v1/iphones/${UDID}`, { token: friend, method: 'PUT' })).status).toBe(403)
  })

  it('takes an older iPhone’s forty-digit ID, and refuses an answer with none', async () => {
    const h = harness()
    const old = 'a1b2c3d4e5'.repeat(4)
    expect((await ask(h, old)).headers.get('location')).toBe(`${DOORMAN_ORIGIN}/v1/device/${old}`)
    expect((await h.call('/v1/device', { method: 'POST', body: 'hello' })).status).toBe(400)
    expect((await h.call('/v1/device/not-an-id')).status).toBe(404)
    expect((await h.call('/v1/device', { method: 'DELETE' })).status).toBe(405)
  })
})
