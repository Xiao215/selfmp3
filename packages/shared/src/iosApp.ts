import { z } from 'zod'
import { DEFAULT_APP_URL, DEFAULT_DOORMAN_URL } from './cloud.js'
import { DOORMAN_PATHS } from './doormanWire.js'
import { escapeHtml, renderPublicPage } from './publicPage.js'
import { RELEASES_URL } from './releases.js'

/**
 * The iPhone app for friends: an ad hoc build, signed for the phones
 * registered on the signing team, installed from a link in Safari.
 *
 * Every build goes to one release, `ios`, replaced in place, so its files keep
 * one address each: the app, the manifest Safari's install link reads, and
 * `ios.json`, which the installed app asks to learn whether there is a newer
 * build of itself. The release is never marked latest — the Mac app's updater
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
export const IOS_INSTALL_PAGE_URL = `${DEFAULT_APP_URL}/install.html`

/** What `ios.json` says about the build on the release. */
export const iosLatestSchema = z.object({
  version: z.string(),
  /** CFBundleVersion: main's commit count when it was built, so later is larger. */
  build: z.number().int().positive(),
  commit: z.string(),
  publishedAt: z.string(),
})
export type IosLatest = z.infer<typeof iosLatestSchema>

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

/** The two steps, in the look `publicPage.ts` gives every page beside the app. */
export function renderInstallPage(doormanUrl: string = DEFAULT_DOORMAN_URL): string {
  const go = (href: string, label: string) =>
    `<p><a class="go" href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`
  return renderPublicPage(
    'Get the iPhone app',
    [
      '<h1>Get the iPhone app</h1>',
      '<p>Open this page in <strong>Safari</strong> on the iPhone. Other browsers cannot install apps.</p>',
      '<h2>1. Send your iPhone’s ID</h2>',
      '<p>An app from outside the App Store installs only on iPhones its signer has added, one by one. Tap below, then <strong>Allow</strong>, then open <strong>Settings</strong>, where <strong>Profile Downloaded</strong> is at the top, and tap <strong>Install</strong>. It says <strong>Not Verified</strong>; that is expected. Nothing stays installed: the iPhone hands over its ID and shows it on a page. Send that to whoever shared self.mp3 with you.</p>',
      go(`${doormanUrl}${DOORMAN_PATHS.device}`, 'Send my iPhone’s ID'),
      '<h2>2. Install self.mp3</h2>',
      '<p>Once you hear your iPhone has been added, come back and tap Install, then <strong>Install</strong> again when the iPhone asks. The app lands on the Home Screen; give it a minute.</p>',
      go(IOS_INSTALL_LINK, 'Install self.mp3'),
      '<p>If it says it cannot install the app, your iPhone is not added yet, or was added after this build: ask for a new one.</p>',
      '<h2>Updates</h2>',
      '<p>The app says when there is a newer build. Its Install button brings the same question as above; your music and settings stay.</p>',
    ].join('\n'),
  )
}
