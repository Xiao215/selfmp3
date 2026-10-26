import { z } from 'zod'
import { DEFAULT_APP_URL } from './cloud.js'
import { RELEASES_URL } from './releases.js'

/**
 * The iPhone app for friends: an ad hoc build, signed for the phones
 * registered on the signing team, installed from a link in Safari.
 *
 * Every build goes to one release, `ios`, replaced in place, so its files keep
 * one address each: the app, the manifest Safari's install link reads, and
 * `ios.json`, which the installed app asks to learn whether there is a newer
 * build of itself. The page friends install from is installPage.ts. The release is never marked latest — the Mac app's updater
 * reads the latest release (releases.ts), and an iPhone build is not one.
 * `apps/app/scripts/ios-release.mjs` builds and uploads all three; the steps
 * around it are in docs/MOBILE.md, "Sharing the iPhone app".
 */

export const IOS_RELEASE_TAG = 'ios'

export const IOS_ASSETS = {
  app: 'selfmp3.ipa',
  manifest: 'manifest.plist',
  latest: 'ios.json',
} as const

export const iosAssetUrl = (name: string): string =>
  `${RELEASES_URL}/download/${IOS_RELEASE_TAG}/${name}`

/** Safari's install link: it reads the manifest, which names the app. */
export const IOS_INSTALL_LINK = `itms-services://?action=download-manifest&url=${encodeURIComponent(
  iosAssetUrl(IOS_ASSETS.manifest),
)}`

/** The page a friend opens on their iPhone, published beside the web app. */
export const IOS_INSTALL_PAGE_URL = `${DEFAULT_APP_URL}/install/`

/** What `ios.json` says about the build on the release. */
export const iosLatestSchema = z.object({
  version: z.string(),
  /** CFBundleVersion: main's commit count when it was built, so later is larger. */
  build: z.number().int().positive(),
  commit: z.string(),
  publishedAt: z.string(),
  /** The iPhones it installs on, each as `iphoneKey` of its ID: never the IDs themselves. */
  devices: z.array(z.string()),
})
export type IosLatest = z.infer<typeof iosLatestSchema>

/**
 * An iPhone's ID as a build lists it: SHA-256 of the ID in capitals, in hex.
 * The release is public, so a friend's page can ask whether a build is theirs
 * without the release naming anybody's iPhone.
 */
export async function iphoneKey(udid: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(udid.toUpperCase()))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** An iPhone's ID: 40 hex digits on older iPhones, `00008140-00094D0436F3001C` since. */
export const IPHONE_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{8}-[0-9a-f]{16})$/i

/**
 * A friend's iPhone, asked for from the install page and kept by the doorman
 * (apps/doorman/src/device.ts) until the owner adds it from the admin page:
 * `waiting`, then `added` — registered with Apple by the next build, which the
 * adding starts.
 */
export const IphoneRequestSchema = z.object({
  udid: z.string().regex(IPHONE_ID),
  /** What they called themselves on the install page; empty when they left it. */
  name: z.string().max(40),
  askedAt: z.number(),
  state: z.enum(['waiting', 'added']),
  addedAt: z.number().optional(),
})
export type IphoneRequest = z.infer<typeof IphoneRequestSchema>

export const IphoneListSchema = z.object({ iphones: z.array(IphoneRequestSchema) })
export type IphoneList = z.infer<typeof IphoneListSchema>

/** What adding an iPhone did about a build: started one, or could not (no token, GitHub said no). */
export const IphoneAddedSchema = z.object({
  iphone: IphoneRequestSchema,
  build: z.enum(['started', 'not-set-up', 'failed']),
})
export type IphoneAdded = z.infer<typeof IphoneAddedSchema>

/**
 * The build on the release, or null when there is none yet or it says
 * something else. Thrown when GitHub does not answer, for the asker to keep
 * quiet about: an update check that fails is not worth a word.
 */
export async function fetchIosLatest(fetchImpl: typeof fetch = fetch): Promise<IosLatest | null> {
  const response = await fetchImpl(iosAssetUrl(IOS_ASSETS.latest), {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const parsed = iosLatestSchema.safeParse(await response.json())
  return parsed.success ? parsed.data : null
}

/** Whether the release has a build this one should be replaced by. */
export function isNewerIosBuild(latest: IosLatest | null, currentBuild: number): boolean {
  return latest !== null && Number.isFinite(currentBuild) && latest.build > currentBuild
}

const xml = (text: string): string =>
  text.replace(/[&<>]/g, char => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))

/** The manifest the install link reads: where the app is, and what it is. */
export function renderIosManifest(app: {
  readonly url: string
  readonly bundleId: string
  readonly version: string
  readonly title: string
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${xml(app.url)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${xml(app.bundleId)}</string>
        <key>bundle-version</key>
        <string>${xml(app.version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${xml(app.title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`
}
