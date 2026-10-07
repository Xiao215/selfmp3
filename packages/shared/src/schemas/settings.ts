import { z } from 'zod'

/**
 * User settings, stored server-side so the desktop and the phone agree.
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
  /**
   * The smart features one at a time (Settings › Smart features,
   * docs/features/ai.md). Off, a feature's way in is not drawn and the server
   * refuses it, so nothing of the library goes to the model for it.
   */
  smartAsk: z.boolean().default(true),
  smartTidy: z.boolean().default(true),
  smartTags: z.boolean().default(true),
  smartWritten: z.boolean().default(true),
  /** Fix metadata's Suggested card: the model reads the song's names and the catalogues' listings. */
  smartMetadata: z.boolean().default(true),
  /** Let the model search the web when the library and the catalogues don't say. Off: it is slower, and your words leave for a search engine. */
  smartWeb: z.boolean().default(false),
  /**
   * How you want things done, for every Ask ("Song names in Chinese only,
   * without the English after them"): saved from an Ask answer, removed in
   * Settings › Smart features, and sent with each request.
   */
  smartNotes: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

export const UpdateSettingsSchema = SettingsSchema.partial().refine(
  patch => Object.keys(patch).length > 0,
  { message: 'no settings to update' },
)
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>
