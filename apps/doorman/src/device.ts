import {
  DOORMAN_PATHS,
  IOS_ASSETS,
  IOS_INSTALL_LINK,
  IPHONE_ID,
  IphoneListSchema,
  REPOSITORY,
  iosAssetUrl,
  iosLatestSchema,
  iphoneKey,
  type IphoneAdded,
  type IphoneList,
  type IphoneRequest,
} from '@selfmp3/shared'
import { requireOwner } from './access.js'
import type { Context } from './context.js'
import { page } from './html.js'
import { badRequest, json, methodNotAllowed, noContent, notFound, readBytes } from './http.js'
import { getRecord, putRecord } from './kv.js'

/**
 * A friend's iPhone, from the install page to the build that installs on it
 * (packages/shared/src/iosApp.ts, docs/MOBILE.md "Sharing the iPhone app").
 *
 * An ad hoc build installs only on iPhones the signing team has registered,
 * and an iPhone shows its ID nowhere a person can find. iOS does offer a
 * profile service: `GET /v1/device?name=…` is a profile that asks the iPhone
 * for its ID; installed, it makes iOS post the ID, signed, to `POST
 * /v1/device?name=…`, which keeps it on the waiting list and answers with a
 * redirect iOS opens in Safari: `/v1/device/<id>`, where the friend sees how
 * far along their iPhone is — waiting, added and being built for, or ready to
 * install. Nothing stays installed on the iPhone.
 *
 * The owner sees the list on the admin page (`/v1/iphones`, admin key or the
 * owner signed in): adding an iPhone marks it `added` and starts the iPhone
 * workflow on GitHub (GITHUB_TOKEN), which registers every added iPhone with
 * Apple and builds for them all. Dropping one forgets the request; an iPhone
 * already registered stays registered with Apple until the membership year
 * ends.
 */

const DEVICE = DOORMAN_PATHS.device
const IPHONES = DOORMAN_PATHS.iphones

/** One record for the whole list: a few dozen iPhones at most, and KV has no listing worth its reads. */
const LIST_KEY = 'iphones'

/** A request nobody added is forgotten after a month. */
const WAITING_MS = 30 * 24 * 60 * 60 * 1000

/** The longest body worth reading: the signed answer is a few kilobytes. */
const MAX_ANSWER = 64 * 1024

/** The longest name kept, as typed on the install page. */
const NAME_MAX = 40

const xml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** What a friend typed on the install page, cut to something a list can show. */
function nameFrom(url: URL): string {
  return (url.searchParams.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
}

async function readList(ctx: Context): Promise<IphoneRequest[]> {
  const list = (await getRecord(ctx.env.KV, LIST_KEY, IphoneListSchema))?.iphones ?? []
  const now = ctx.now()
  return list.filter(one => one.state === 'added' || now - one.askedAt < WAITING_MS)
}

async function writeList(ctx: Context, iphones: IphoneRequest[]): Promise<void> {
  const record: IphoneList = { iphones }
  await putRecord(ctx.env.KV, LIST_KEY, record)
}

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

// ---------------------------------------------------------------- the friend

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
  if (!rest.startsWith('/') || !IPHONE_ID.test(id)) throw notFound()
  return shown(ctx, id)
}

function profile(ctx: Context): Response {
  const name = nameFrom(ctx.url)
  const back = `${ctx.url.origin}${DEVICE}${name ? `?name=${encodeURIComponent(name)}` : ''}`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${xml(back)}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>PRODUCT</string>
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
 * checked: what it vouches for is only that some iPhone asked, and the owner
 * decides on the admin page whether it is added. So the plist is simply found
 * in the bytes, and the iPhone kept as waiting, with the name it came with.
 */
async function received(ctx: Context): Promise<Response> {
  const bytes = await readBytes(ctx.request.body, MAX_ANSWER)
  // The signature's bytes decode as noise around it; the plist is plain ASCII.
  const text = new TextDecoder().decode(bytes)
  const id = /<key>UDID<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1]?.trim()
  if (!id || !IPHONE_ID.test(id)) throw badRequest('no iPhone ID in that answer')

  const name = nameFrom(ctx.url)
  const list = await readList(ctx)
  const known = list.find(one => same(one.udid, id))
  if (!known) {
    await writeList(ctx, [...list, { udid: id, name, askedAt: ctx.now(), state: 'waiting' }])
  } else if (
    known.state === 'waiting' &&
    (name !== known.name || ctx.now() - known.askedAt > 60_000)
  ) {
    // Asked again: the name it now comes with, and a month from now.
    await writeList(
      ctx,
      list.map(one =>
        one === known ? { ...one, name: name || one.name, askedAt: ctx.now() } : one,
      ),
    )
  }
  // A 301, not a 302: iOS follows only a permanent redirect out of the profile
  // installer, into Safari.
  return new Response(null, {
    status: 301,
    headers: { location: `${ctx.url.origin}${DEVICE}/${id}`, 'cache-control': 'no-store' },
  })
}

/** Whether the build on the release installs on this iPhone. */
async function inTheBuild(ctx: Context, id: string): Promise<boolean> {
  try {
    const response = await ctx.fetch(iosAssetUrl(IOS_ASSETS.latest), {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return false
    const latest = iosLatestSchema.safeParse(await response.json())
    return latest.success && latest.data.devices.includes(await iphoneKey(id))
  } catch {
    return false
  }
}

async function shown(ctx: Context, id: string): Promise<Response> {
  const [list, ready] = await Promise.all([readList(ctx), inTheBuild(ctx, id)])
  const known = list.find(one => same(one.udid, id))
  const hello = known?.name ? `Thanks, ${known.name}. ` : ''
  if (ready) {
    return page({
      status: 200,
      title: 'Ready to install',
      lines: [
        `${hello}self.mp3 is ready for this iPhone. Tap Install, then Install again when iOS asks.`,
      ],
      link: { href: IOS_INSTALL_LINK, label: 'Install self.mp3' },
    })
  }
  if (known?.state === 'added') {
    return page({
      status: 200,
      title: 'Added',
      lines: [
        `${hello}Your iPhone is on the list, and a copy of self.mp3 is being made for it. That takes about an hour.`,
        'Come back to this page then: it will have an Install button.',
      ],
    })
  }
  return page({
    status: 200,
    title: 'Asked',
    lines: [
      `${hello}Your iPhone is waiting to be added. Once it is, a copy of self.mp3 is made for it.`,
      'Keep this page: it will say when it is ready.',
    ],
    code: id,
    notes: ['That is your iPhone’s ID, if you are asked for it.'],
  })
}

// ----------------------------------------------------------------- the owner

/** `/v1/iphones` and `/v1/iphones/<id>`: the waiting list, for the owner's admin page. */
export async function iphones(ctx: Context): Promise<Response> {
  await requireOwner(ctx)
  const { method } = ctx.request
  const rest = ctx.url.pathname.slice(IPHONES.length)
  if (rest === '') {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    const list: IphoneList = { iphones: await readList(ctx) }
    return json(list)
  }
  const id = decodeURIComponent(rest.slice(1))
  if (!rest.startsWith('/') || !IPHONE_ID.test(id)) throw notFound()
  if (method === 'PUT') return added(ctx, id)
  if (method === 'DELETE') {
    const list = await readList(ctx)
    if (list.some(one => same(one.udid, id)))
      await writeList(
        ctx,
        list.filter(one => !same(one.udid, id)),
      )
    return noContent()
  }
  return methodNotAllowed(['PUT', 'DELETE'])
}

async function added(ctx: Context, id: string): Promise<Response> {
  const list = await readList(ctx)
  const known = list.find(one => same(one.udid, id))
  if (!known) throw notFound('no iPhone asked with that ID')
  const iphone: IphoneRequest =
    known.state === 'added' ? known : { ...known, state: 'added', addedAt: ctx.now() }
  if (iphone !== known)
    await writeList(
      ctx,
      list.map(one => (one === known ? iphone : one)),
    )
  const body: IphoneAdded = { iphone, build: await startBuild(ctx) }
  return json(body)
}

/** Starts the iPhone workflow on main, which registers every added iPhone and builds for them. */
async function startBuild(ctx: Context): Promise<IphoneAdded['build']> {
  const token = ctx.env.GITHUB_TOKEN?.trim()
  if (!token) return 'not-set-up'
  const url = `https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}/actions/workflows/ios.yml/dispatches`
  try {
    const response = await ctx.fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'selfmp3-doorman',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    })
    if (response.status === 204) return 'started'
    ctx.log.warn('GitHub would not start the iPhone build', { status: response.status })
    return 'failed'
  } catch (error) {
    ctx.log.warn('GitHub could not be reached to start the iPhone build', {
      message: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}
