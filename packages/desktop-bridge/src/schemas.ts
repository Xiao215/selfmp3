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

/** Nothing to say, said in a way zod can parse. */
export const emptySchema = z.undefined()
