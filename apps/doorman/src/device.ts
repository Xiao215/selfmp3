import { DOORMAN_PATHS } from '@selfmp3/shared'
import type { Context } from './context.js'
import { page } from './html.js'
import { badRequest, methodNotAllowed, notFound, readBytes } from './http.js'

/**
 * An iPhone's ID (its UDID), for the iPhone app's install page
 * (packages/shared/src/iosApp.ts).
 *
 * An ad hoc build installs only on iPhones its signer has added, by ID, and an
 * iPhone shows its ID nowhere a person can find. What iOS does offer is a
 * profile service: `GET /v1/device` is a profile that asks the iPhone for its
 * ID; once it is installed, iOS posts the ID, signed, to the address the
 * profile names, which is `POST /v1/device`; that answers with a redirect,
 * which iOS opens in Safari: `/v1/device/<id>`, a page with the ID on it to
 * send on. Nothing is kept, and nothing stays installed.
 */

const DEVICE = DOORMAN_PATHS.device

/** The longest body worth reading: the signed answer is a few kilobytes. */
const MAX_ANSWER = 64 * 1024

/** A UDID: 40 hex digits on older iPhones, `00008140-00094D0436F3001C` since. */
const UDID = /^(?:[0-9a-f]{40}|[0-9a-f]{8}-[0-9a-f]{16})$/i

export function device(ctx: Context): Promise<Response> {
  const { method } = ctx.request
  const rest = ctx.url.pathname.slice(DEVICE.length)
  if (rest === '') {
    if (method === 'GET') return Promise.resolve(profile(ctx))
    if (method === 'POST') return received(ctx)
    return Promise.resolve(methodNotAllowed(['GET', 'POST']))
  }
  if (method !== 'GET') return Promise.resolve(methodNotAllowed(['GET']))
  const id = decodeURIComponent(rest.slice(1))
  if (!rest.startsWith('/') || !UDID.test(id)) throw notFound()
  return shown(id)
}

function profile(ctx: Context): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${ctx.url.origin}${DEVICE}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
    </array>
  </dict>
  <key>PayloadOrganization</key>
  <string>self.mp3</string>
  <key>PayloadDisplayName</key>
  <string>self.mp3: this iPhone’s ID</string>
  <key>PayloadDescription</key>
  <string>Hands this iPhone’s ID to self.mp3, so a build of the app can be made for it. Nothing stays installed.</string>
  <key>PayloadIdentifier</key>
  <string>app.selfmp3.device-id</string>
  <key>PayloadUUID</key>
  <string>6C1D1C3B-5B0E-4F55-9E6A-3A1F2D7C9B10</string>
  <key>PayloadType</key>
  <string>Profile Service</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`
  return new Response(body, {
    headers: {
      'content-type': 'application/x-apple-aspen-config',
      'content-disposition': 'attachment; filename="selfmp3-iphone-id.mobileconfig"',
      'cache-control': 'no-store',
    },
  })
}

/**
 * The iPhone's answer: a plist inside a signature. The signature is not
 * checked — the ID is only shown back to the person holding the iPhone, who
 * could as well have typed it — so the plist is simply found in the bytes.
 */
async function received(ctx: Context): Promise<Response> {
  const bytes = await readBytes(ctx.request.body, MAX_ANSWER)
  // The signature's bytes decode as noise around it; the plist is plain ASCII.
  const text = new TextDecoder().decode(bytes)
  const id = /<key>UDID<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1]?.trim()
  if (!id || !UDID.test(id)) throw badRequest('no iPhone ID in that answer')
  // A 301, not a 302: iOS follows only a permanent redirect out of the profile
  // installer, into Safari.
  return new Response(null, {
    status: 301,
    headers: { location: `${ctx.url.origin}${DEVICE}/${id}`, 'cache-control': 'no-store' },
  })
}

function shown(id: string): Promise<Response> {
  return page({
    status: 200,
    title: 'Your iPhone’s ID',
    lines: ['Copy it, and send it to whoever shared self.mp3 with you.'],
    code: id,
    notes: [
      'Once they say your iPhone has been added, go back to the install page and tap Install self.mp3.',
    ],
  })
}
