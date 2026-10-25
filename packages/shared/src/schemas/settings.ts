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
  /** Tags applied to every imported song, on top of per-import tags. */
  defaultImportTagIds: z.array(z.number().int().positive()).max(20).default([]),
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
   * Smart features at all (Settings › Smart features' "Use smart features").
   * Off, every one of them is off whatever its own switch says, and each
   * keeps its own switch for when this is turned back on.
   */
  smartFeatures: z.boolean().default(true),
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
  /** Import's review: the model reads the names of the songs about to come in, and suggests better ones. */
  smartImport: z.boolean().default(true),
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
