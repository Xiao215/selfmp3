import type { MacChip, MacInstallers } from '@selfmp3/shared'

/**
 * The desktop app, offered to a browser that could install it.
 *
 * `offered` is true only in a browser tab on a Mac: the installed app *is* the
 * desktop app, a phone cannot open a dmg, and a Windows or Linux browser has
 * no build to be offered (docs/FEATURE_TODO.md, "The desktop app"). Everywhere
 * else Settings shows no section at all rather than a download that would
 * land in the wrong place.
 *
 * `chip` is which Mac this is, where the browser will say — Chromium answers
 * through Client Hints; Safari does not, and the person is asked instead.
 * `latest` is the newest release's installers, from GitHub, or null while
 * there is no release yet.
 */
export interface MacAppPort {
  readonly offered: boolean
  chip(): Promise<MacChip | null>
  latest(): Promise<MacInstallers | null>
}

export const macApp: MacAppPort = {
  offered: false,
  chip: () => Promise.resolve(null),
  latest: () => Promise.resolve(null),
}
