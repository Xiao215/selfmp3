import { z } from 'zod'

/**
 * Everything that crosses the preload boundary, as a zod schema.
 *
 * The rule the repository already follows for the server's API: the contract is
 * shared code, not documentation. Both `apps/desktop` (which implements it) and
 * `apps/app` (which consumes it) import these, and every message is parsed on
 * the *receiving* side. An invalid message is then an error at the boundary,
 * with a name and a path, rather than an `undefined` that surfaces three
 * functions later as a crash in the middle of playback.
 *
 * Parsing both ways is deliberate. The renderer is a web page: if it is ever
 * compromised, the main process is the thing with a filesystem, and a schema is
 * what stands between them.
 */

/** What the shell is, and where it keeps things. */
export const desktopInfoSchema = z.object({
  platform: z.enum(['darwin', 'win32', 'linux']),
  /** The app's version, from `apps/desktop/package.json`. */
  version: z.string().min(1),
  /** "Xiao's MacBook Pro" — the device name a browser has to guess at. */
  hostname: z.string().min(1),
  /** `~/Library/Application Support/self.mp3`, shown in Settings. */
  userData: z.string().min(1),
  /** Where downloaded songs live, shown in Settings and revealed in Finder. */
  songsDir: z.string().min(1),
  /** True in `npm run dev:desktop`, where the page comes from Metro. */
  development: z.boolean(),
  /**
   * False when this machine has no keychain behind `safeStorage` — a Linux
   * session with no secret service, most often. Secrets are then kept plainly,
   * which is exactly the promise a browser makes, and Settings says so rather
   * than the app refusing to sign in.
   */
  secretsSealed: z.boolean(),
  /**
   * How much room the window's own chrome takes at the top of the page, in
   * CSS pixels. `titleBarStyle: 'hiddenInset'` puts the traffic lights over the
   * sidebar, so the sidebar pads itself by this much and nothing sits under
   * them. Zero everywhere else, including in a browser tab, which is why the
   * page asks rather than checking the platform.
   */
  titleBarInset: z.number().min(0).max(200),
})
export type DesktopInfo = z.infer<typeof desktopInfoSchema>

/**
 * A secret's key. Deliberately narrow: these become nothing on disk but a JSON
 * key, and a key with a slash or a dot-dot in it is the kind of thing that
 * turns a store into a path.
 */
export const secretKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/, 'a secret key is letters, digits, dot, dash and underscore')

export const secretValueSchema = z.string().max(64 * 1024)

/** `null` rather than `undefined`: `undefined` does not survive a structured clone. */
export const secretReadSchema = z.string().nullable()

/**
 * An external URL. Only `https:` — and `http:` for a server on the local
 * network, which is the whole point of the address path. `openExternal` hands
 * whatever it is given to the operating system, and `file:` there opens a file
 * the page chose.
 */
export const externalUrlSchema = z
  .string()
  .url()
  .refine(value => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'only http and https URLs may be opened outside the app',
  })

/** A `selfmp3://` URL the operating system handed the app. */
export const deepLinkSchema = z.string().startsWith('selfmp3://')

/**
 * What the application menu and the media keys can ask the page to do.
 *
 * The menu is the shell's and the behaviour is the page's, so this list is the
 * whole of what the shell may say. `menu.ts` asserts that every accelerator it
 * draws names one of these, which is how a menu item that does nothing becomes
 * a failing test rather than a dead key.
 */
export const commandSchema = z.enum([
  'play-pause',
  'next',
  'previous',
  'search',
  'settings',
  'now-playing',
  'library',
  'playlists',
  'practice',
  'volume-up',
  'volume-down',
  'mute',
  'shuffle',
  'repeat',
  'seek-forward',
  'seek-back',
])
export type Command = z.infer<typeof commandSchema>

/** Told to the shell so it can hold a power-save blocker and label the Dock. */
export const playbackStateSchema = z.object({
  playing: z.boolean(),
  /** What is playing, for the Dock menu to name. Null when nothing is. */
  title: z.string().max(300).nullable(),
  artist: z.string().max(300).nullable(),
})
export type PlaybackState = z.infer<typeof playbackStateSchema>

export const loginItemSchema = z.object({ open: z.boolean() })

/**
 * What "check for updates" answered.
 *
 * `state` is the whole vocabulary: an ad-hoc build can only ever compare
 * versions and offer the release page, because Squirrel refuses to apply an
 * update to a signature it cannot verify (electron #36640).
 */
export const updateStatusSchema = z.object({
  state: z.enum(['idle', 'checking', 'none', 'available', 'downloading', 'ready', 'error']),
  /** The version found, when one was. */
  version: z.string().nullable(),
  /** Where a person can get it by hand, for the unsigned tier. */
  releaseUrl: z.string().nullable(),
  /** True when this build can apply an update itself. */
  canInstall: z.boolean(),
  message: z.string().nullable(),
})
export type UpdateStatus = z.infer<typeof updateStatusSchema>

/**
 * The two kinds of file the shell keeps, and nothing else.
 *
 * An enum rather than a path, because this is the whole of what the page may
 * name: `songs` and `covers` are directories under `userData`, and a `kind` that
 * could be anything would be a path the renderer chose.
 */
export const fileKindSchema = z.enum(['songs', 'covers'])
export type FileKind = z.infer<typeof fileKindSchema>

/**
 * A file's name inside its kind's directory.
 *
 * Deliberately one flat segment: no slash, no `..`, no leading dot, and a
 * length a filesystem will take. The shell checks this *and* fences the
 * resolved path inside the directory (`paths.ts`), because one check is a
 * check and two is a rule.
 */
export const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._'()-]*$/, 'a file name is one flat segment')
  .refine(value => !value.includes('..'), { message: 'no climbing out' })

/**
 * The text of a small file the page writes itself: the download index.
 *
 * A megabyte is far more than an index of a personal library will ever be, and
 * far less than a page could use this channel to fill a disk with. Text and not
 * bytes on purpose — the only thing the page has to write is JSON, and a
 * channel that took arbitrary bytes would be a channel for putting an
 * executable on someone's computer.
 */
export const fileTextSchema = z.string().max(1024 * 1024)

/** A download's id, the page's own handle on it, used to cancel. */
export const transferIdSchema = z.string().min(1).max(128)

/** Where a song's bytes come from: the server, or the bucket through the doorman. */
export const downloadRequestSchema = z.object({
  id: transferIdSchema,
  kind: fileKindSchema,
  name: fileNameSchema,
  url: z.string().url(),
  /**
   * The doorman reads a bearer header and nothing else, so a download from the
   * bucket carries one. Kept out of the URL on purpose: a URL ends up in logs.
   */
  headers: z.record(z.string(), z.string()).optional(),
  /** Continue an interrupted file from this many bytes. */
  resumeFrom: z.number().int().nonnegative().optional(),
})
export type DownloadRequest = z.infer<typeof downloadRequestSchema>

export const downloadResultSchema = z.object({
  /** `done`: the whole file is there under its real name. */
  state: z.enum(['done', 'cancelled']),
  bytes: z.number().int().nonnegative(),
})
export type DownloadResult = z.infer<typeof downloadResultSchema>

/** Sent as it goes, not asked for. */
export const transferProgressSchema = z.object({
  id: transferIdSchema,
  bytesWritten: z.number().int().nonnegative(),
  /** Zero when the source did not say how big it is. */
  totalBytes: z.number().int().nonnegative(),
})
export type TransferProgress = z.infer<typeof transferProgressSchema>

export const fileStatSchema = z
  .object({ name: fileNameSchema, bytes: z.number().int().nonnegative() })
  .nullable()
export type FileStat = z.infer<typeof fileStatSchema>

export const fileListSchema = z.array(
  z.object({ name: fileNameSchema, bytes: z.number().int().nonnegative() }),
)

/** What Settings shows about this computer's disk. */
export const usageSchema = z.object({
  songs: z.number().int().nonnegative(),
  covers: z.number().int().nonnegative(),
  /** Bytes free on the volume `userData` is on; zero when it cannot be read. */
  free: z.number().int().nonnegative(),
})
export type Usage = z.infer<typeof usageSchema>

/** Nothing to say, said in a way zod can parse. */
export const emptySchema = z.undefined()
