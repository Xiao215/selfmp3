import { z } from 'zod'

/**
 * A library's settings: what its server acts on — importing, its folder, the
 * smart features — kept in the server's settings table, one per library (each
 * workspace of a hub has its own). A cloud library reaches its server for them
 * (`useServerApi` in the app); the bucket holds none of them.
 *
 * What a device acts on — crossfade, which songs are kept offline on *this*
 * phone, pinyin under the words — is that device's own (`ports/prefs` in the
 * app): sharing it would be actively wrong, and it has to work with no server.
 */

/** How many things Ask remembers (`smartNotes`): the schema refuses more, and the app says so first. */
export const SMART_NOTES_MAX = 30
export const SettingsSchema = z.object({
  /** Automatically look up lyrics for songs that do not have any. */
  autoFetchLyrics: z.boolean().default(true),
  /** How many downloads run at once. More is not always faster. */
  importConcurrency: z.number().int().min(1).max(4).default(2),
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
   * The smart features, all of them (Settings › Smart features' "Use smart
   * features", docs/features/ai.md). Off, their ways in are not drawn and the
   * server refuses them, so nothing of the library goes to the model.
   */
  smartFeatures: z.boolean().default(true),
  /**
   * How you want things done, for every Ask ("Song names in Chinese only,
   * without the English after them"): saved from an Ask answer, removed in
   * Settings › Smart features, and sent with each request.
   */
  smartNotes: z.array(z.string().trim().min(1).max(200)).max(SMART_NOTES_MAX).default([]),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

export const UpdateSettingsSchema = SettingsSchema.partial().refine(
  patch => Object.keys(patch).length > 0,
  { message: 'no settings to update' },
)
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>
