import { z } from 'zod'
import { DEFAULT_APP_URL } from './cloud.js'
import { RELEASES_URL } from './releases.js'

/**
 * The phone app for friends, iPhone (iosApp.ts) and Android (androidApp.ts)
 * alike: every build goes to one release per phone, replaced in place, so its
 * files keep one address each. One of them is a small JSON file the installed
 * app asks to learn whether there is a newer build of itself. The releases are
 * never marked latest — the Mac app's updater reads the latest release
 * (releases.ts), and a phone build is not one. `apps/app/scripts/*-release.mjs`
 * build and upload them; the steps around them are in docs/MOBILE.md.
 */

/** The page a friend opens on their phone, either phone's (installPage.ts), beside the web app. */
export const INSTALL_PAGE_URL = `${DEFAULT_APP_URL}/install/`

export const releaseAssetUrl = (tag: string, name: string): string =>
  `${RELEASES_URL}/download/${tag}/${name}`

/** What a release's JSON file says about the build on it. */
export const phoneBuildSchema = z.object({
  version: z.string(),
  /** The build number: main's commit count when it was built, so later is larger. */
  build: z.number().int().positive(),
  commit: z.string(),
  publishedAt: z.string(),
})
export type PhoneBuild = z.infer<typeof phoneBuildSchema>

/**
 * The build on a release, or null when there is none yet or it says
 * something else. Thrown when GitHub does not answer, for the asker to keep
 * quiet about: an update check that fails is not worth a word.
 */
export async function fetchPhoneBuild<Build extends PhoneBuild>(
  url: string,
  schema: z.ZodType<Build>,
  fetchImpl: typeof fetch = fetch,
): Promise<Build | null> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const parsed = schema.safeParse(await response.json())
  return parsed.success ? parsed.data : null
}

/** Whether the release has a build this one should be replaced by. */
export function isNewerBuild(latest: PhoneBuild | null, currentBuild: number): boolean {
  return latest !== null && Number.isFinite(currentBuild) && latest.build > currentBuild
}

/** How long the app keeps quiet after saying a newer build is ready. */
export const BUILD_ANNOUNCE_GAP_MS = 24 * 60 * 60 * 1000

/**
 * Whether the app should say, in a toast, that this newer build is ready: a
 * build it has not said yet, and not within a day of the last it did. A build
 * is published with every push that changes the app, several on a busy day,
 * and a friend hears of them at most once a day; Settings › About has the
 * newest at any time.
 */
export function announcesBuild(
  build: number,
  last: { readonly build: number; readonly at: number } | null,
  now: number,
): boolean {
  if (!last) return true
  return build !== last.build && now - last.at >= BUILD_ANNOUNCE_GAP_MS
}

/** How long after a build was handed to the system the app, started again, still speaks of it. */
export const BUILD_INSTALL_WATCH_MS = 60 * 60 * 1000

/**
 * What became of the build last handed to the system to install, as the app
 * starting again finds it: `in` when this is it or later, `not-in` when this
 * is still the older one — the system stopped it, or the install was never
 * chosen — and null when there was none, or it was long enough ago not to be
 * worth a word.
 */
export function installOutcome(
  tried: { readonly build: number; readonly at: number } | null,
  currentBuild: number,
  now: number,
): 'in' | 'not-in' | null {
  if (!tried || !Number.isFinite(currentBuild) || now - tried.at > BUILD_INSTALL_WATCH_MS)
    return null
  return currentBuild >= tried.build ? 'in' : 'not-in'
}
