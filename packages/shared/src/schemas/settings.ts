import { z } from 'zod'

/**
 * User settings, stored server-side so the Mac and the phone agree.
 *
 * Anything device-specific (volume, which songs are cached offline on *this*
 * phone) deliberately lives in browser storage instead — syncing it would be
 * actively wrong.
 */
export const SettingsSchema = z.object({
  /** Seconds of overlap between tracks. Zero disables crossfade entirely. */
  crossfadeSeconds: z.number().min(0).max(12).default(0),
  /** Skip leading/trailing silence so tracks run together cleanly. */
  gapless: z.boolean().default(true),
  /** Fraction of a track that must be heard before it counts as a play. */
  playThreshold: z.number().min(0.05).max(1).default(0.5),
  /** Automatically look up lyrics for songs that do not have any. */
  autoFetchLyrics: z.boolean().default(true),
  /** How many downloads run at once. More is not always faster. */
  importConcurrency: z.number().int().min(1).max(4).default(2),
  /** Tags applied to every imported song, on top of per-import tags. */
  defaultImportTagIds: z.array(z.number().int().positive()).max(20).default([]),
  /** Rescan the library folder on a timer, in minutes. Zero disables it. */
  autoScanMinutes: z.number().int().min(0).max(1440).default(0),
  /** Watch the library folder and rescan when files change, no timer needed. */
  watchLibrary: z.boolean().default(true),
  /**
   * Where yt-dlp gets YouTube login cookies from, so private playlists and
   * Liked Music resolve. 'browser' reads the browser's own cookie store;
   * 'file' reads a Netscape-format cookies.txt.
   */
  ytCookieSource: z.enum(['none', 'browser', 'file']).default('none'),
  ytCookieBrowser: z
    .enum(['chrome', 'safari', 'firefox', 'brave', 'edge', 'chromium'])
    .default('chrome'),
  /** Absolute path to a cookies.txt, used when ytCookieSource is 'file'. */
  ytCookieFile: z.string().trim().max(1000).default(''),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  /** Accent hue for the whole UI. */
  accentHue: z.number().int().min(0).max(359).default(268),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

export const UpdateSettingsSchema = SettingsSchema.partial().refine(
  patch => Object.keys(patch).length > 0,
  { message: 'no settings to update' },
)
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>
