import { z } from 'zod'

/**
 * Where the desktop app's builds are published, and how a version is read.
 *
 * The releases page of this repository: `.github/workflows/desktop.yml`
 * attaches the dmgs, the zips and `latest-mac.yml` to a release on a
 * `desktop-v*` tag, and the installed app's updater reads the same place. A
 * fork publishes its own releases and changes these two lines, as with the
 * doorman and the app's address in `cloud.ts`.
 *
 * Here rather than in the shell, because two things read the releases: the
 * installed app, asking whether there is a newer one of itself, and a browser
 * tab on a Mac, offering the app to install (Settings › Mac app). Both must
 * agree on where to look and on what a tag means.
 */
const REPO_OWNER = 'Xiao215'
const REPO_NAME = 'selfmp3'

export const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/** `desktop-v1.2.3` or `v1.2.3` or `1.2.3` — whatever the tag was called. */
export function versionFromTag(tag: string): string | null {
  return /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(tag)?.[1] ?? null
}

/**
 * Semver compare, enough of it: three numbers, and a prerelease suffix loses to
 * the release of the same numbers. Written rather than depended on, because the
 * whole use is "is that one newer than this one".
 */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (value: string): [number[], string] => {
    const [core = '', pre = ''] = value.split('-', 2)
    return [core.split('.').map(one => Number.parseInt(one, 10) || 0), pre]
  }
  const [a, aPre] = parts(candidate)
  const [b, bPre] = parts(current)
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left > right
  }
  if (aPre === bPre) return false
  // 1.2.0 beats 1.2.0-beta.1; 1.2.0-beta.2 beats 1.2.0-beta.1.
  if (aPre === '') return true
  if (bPre === '') return false
  return aPre > bPre
}

/** The two Macs a release is built for, named as electron-builder names the files. */
export type MacChip = 'arm64' | 'x64'
export const MAC_CHIPS: readonly MacChip[] = ['arm64', 'x64']

/** What to call a chip to the person choosing a download. */
export const MAC_CHIP_NAMES: Readonly<Record<MacChip, string>> = {
  arm64: 'Apple silicon',
  x64: 'Intel',
}

/**
 * A release as GitHub's API describes it, the parts that matter. Anything else
 * in the body is let through: the shape is GitHub's to grow.
 */
const ReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })).default([]),
})

export interface MacInstallers {
  /** From the tag, or null for a tag with no version in it. */
  readonly version: string | null
  /** The release's own page, for a chip with no dmg or a browser that cannot say which. */
  readonly page: string
  /** The dmg for each chip, where the release has one. */
  readonly dmg: Readonly<Record<MacChip, string | null>>
}

/**
 * The installers in a release, from GitHub's answer for it. `null` for a body
 * that is not a release at all.
 *
 * The dmg for a chip is the asset whose name ends `-<chip>.dmg`, which is how
 * `apps/desktop/electron-builder.yml` names them — the arch in every name is
 * what stops the Intel one being called `self.mp3-1.0.0.dmg` and installed on
 * an M1.
 */
export function macInstallers(body: unknown): MacInstallers | null {
  const parsed = ReleaseSchema.safeParse(body)
  if (!parsed.success) return null
  const { tag_name, html_url, assets } = parsed.data
  const dmgFor = (chip: MacChip): string | null =>
    assets.find(asset => asset.name.endsWith(`-${chip}.dmg`))?.browser_download_url ?? null
  return {
    version: versionFromTag(tag_name),
    page: html_url,
    dmg: { arm64: dmgFor('arm64'), x64: dmgFor('x64') },
  }
}
