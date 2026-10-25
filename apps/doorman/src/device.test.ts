import { describe, expect, it } from 'vitest'
import { DOORMAN_ORIGIN, harness } from './fakes.js'

/** An iPhone's ID, by profile service (device.ts), for the iPhone app's install page. */

const UDID = '00008140-00094D0436F3001C'

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

describe("an iPhone's ID", () => {
  it('asks for it with a profile that sends it back to the doorman', async () => {
    const response = await harness().call('/v1/device')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-apple-aspen-config')
    const profile = await response.text()
    expect(profile).toContain('<string>Profile Service</string>')
    expect(profile).toContain(`<string>${DOORMAN_ORIGIN}/v1/device</string>`)
    expect(profile).toContain('<string>UDID</string>')
  })

  it('sends the iPhone on to a page with its ID, by a permanent redirect', async () => {
    const h = harness()
    const posted = await h.call('/v1/device', {
      method: 'POST',
      headers: { 'content-type': 'application/pkcs7-signature' },
      body: answer(UDID),
    })
    expect(posted.status).toBe(301)
    const location = posted.headers.get('location') ?? ''
    expect(location).toBe(`${DOORMAN_ORIGIN}/v1/device/${UDID}`)

    const shown = await h.call(new URL(location).pathname)
    expect(shown.status).toBe(200)
    expect(await shown.text()).toContain(UDID)
  })

  it('takes an older iPhone’s forty-digit ID too', async () => {
    const old = 'a1b2c3d4e5'.repeat(4)
    const posted = await harness().call('/v1/device', { method: 'POST', body: answer(old) })
    expect(posted.headers.get('location')).toBe(`${DOORMAN_ORIGIN}/v1/device/${old}`)
  })

  it('refuses an answer with no ID, and shows no page for something that is not one', async () => {
    const h = harness()
    expect((await h.call('/v1/device', { method: 'POST', body: 'hello' })).status).toBe(400)
    expect((await h.call('/v1/device', { method: 'POST', body: answer('<b>') })).status).toBe(400)
    expect((await h.call('/v1/device/not-an-id')).status).toBe(404)
    expect((await h.call('/v1/device', { method: 'DELETE' })).status).toBe(405)
  })
})
