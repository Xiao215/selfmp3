import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'
import type { CloudPlatform, DeviceStore, TextCache } from '@selfmp3/cloud'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import * as Linking from 'expo-linking'
import { AppState, Platform } from 'react-native'

/**
 * What a phone gives `@selfmp3/cloud` (packages/cloud/src/platform.ts).
 *
 * All of React Native in one file, so that everything else about keeping a copy
 * of the library — signing in, replaying a snapshot, the outbox and its
 * sequence numbers — is the same code the browser already runs.
 *
 * The browser's version of this file is apps/web/src/lib/cloud/webPlatform.ts.
 * Between them they are the whole difference between the two apps.
 */

const ROOT = new Directory(Paths.document, 'cloud')
const CACHE = new Directory(Paths.cache, 'cloud-files')

function ensure(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true })
}

/** A key is a file name, so anything not plainly safe in one is escaped. */
function fileFor(dir: Directory, key: string): File {
  return new File(dir, `${encodeURIComponent(key)}.json`)
}

/**
 * Small things, as JSON files in the app's documents directory.
 *
 * A phone has one JavaScript context, so `update` is simply read-change-write:
 * the transaction the browser needs is for two tabs sharing an origin, and
 * there are no tabs here. The promise chain is still wanted, because two
 * `update`s in flight at once would interleave their reads and one would lose
 * — and the thing most often updated is the outbox, where losing a write means
 * handing out a log sequence number twice.
 */
function documentStore(): DeviceStore {
  let queue: Promise<unknown> = Promise.resolve()
  const serialise = <T>(work: () => T | Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const readNow = (key: string): unknown => {
    ensure(ROOT)
    const file = fileFor(ROOT, key)
    if (!file.exists) return null
    try {
      return JSON.parse(file.textSync()) as unknown
    } catch {
      // Half-written, or written by a version that wrote something else.
      return null
    }
  }

  const writeNow = (key: string, value: unknown): void => {
    ensure(ROOT)
    fileFor(ROOT, key).write(JSON.stringify(value ?? null))
  }

  return {
    read: key => serialise(() => readNow(key)),
    write: (key, value) => serialise(() => writeNow(key, value)),
    remove: key =>
      serialise(() => {
        const file = fileFor(ROOT, key)
        if (file.exists) file.delete()
      }),
    update: (key, change) =>
      serialise(() => {
        const next = change(readNow(key))
        writeNow(key, next)
        return next
      }),
  }
}

/** Lyrics, in the cache directory — the OS may reclaim it, and that is fine. */
const textCache: TextCache = {
  read: key => {
    try {
      ensure(CACHE)
      const file = fileFor(CACHE, key)
      return Promise.resolve(file.exists ? file.textSync() : null)
    } catch {
      return Promise.resolve(null)
    }
  },
  write: (key, text) => {
    try {
      ensure(CACHE)
      fileFor(CACHE, key).write(text)
    } catch {
      // Out of room: it is a cache, and the next read fetches again.
    }
    return Promise.resolve()
  },
  clear: () => {
    try {
      if (CACHE.exists) CACHE.delete()
    } catch {
      // Nothing to clear.
    }
    return Promise.resolve()
  },
}

/**
 * The doorman this build signs in through.
 *
 * Checked for being a string rather than merely present, because Expo turns a
 * null in `extra` into `{}` on the way through — which is not null, so a `??`
 * fallback keeps it, and the address silently becomes "[object Object]".
 */
const configured = (Constants.expoConfig?.extra as { doormanUrl?: unknown } | undefined)?.doormanUrl
const doormanUrl =
  typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_DOORMAN_URL

export const nativePlatform: CloudPlatform = {
  doormanUrl,
  store: documentStore(),
  fetch: (url, init) => fetch(url, init as RequestInit),

  // Hermes has no `crypto.getRandomValues`, and this is the attempt id: one
  // somebody could guess is a session somebody could claim.
  randomBytes: into => into.set(Crypto.getRandomBytes(into.length)),

  /**
   * Back into the app, by its own scheme.
   *
   * What comes back is the code, in the fragment, exactly as it does for the
   * web app — and not the attempt, which was made here and never left. So the
   * worst another app claiming this scheme can do is hold half of a pair.
   * That is the whole reason the code exists, and why this is safe on a phone
   * where iOS lets any app register any scheme.
   *
   * A doorman that does not know this scheme drops it and shows the code on
   * its own page instead, which still works — so an app newer than its
   * doorman degrades to typing rather than breaking.
   */
  returnUrl: 'selfmp3://sign-in',
  // The promise is returned, not dropped. `openSignIn` may fail — no browser,
  // a refusal from the OS — and a floating promise turns that into an uncaught
  // rejection nobody sees, leaving the screen saying "Waiting for Google…"
  // forever about a Google that was never opened.
  openSignIn: url => Linking.openURL(url).then(() => undefined),

  deviceKind: Platform.OS === 'ios' ? 'iphone' : 'android',

  /** Coming back to the front is this device's "the network might be back". */
  onWake: run => {
    AppState.addEventListener('change', state => {
      if (state === 'active') run()
    })
  },

  /**
   * The bytes are already plain: both OkHttp and NSURLSession inflate a gzip
   * response before handing it over, and the doorman relays the encoding
   * header. A browser has to undo it by hand; a phone does not.
   */
  decodeText: bytes => Promise.resolve(new TextDecoder().decode(bytes)),

  textCache,
  warn: message => console.warn(`self.mp3: ${message}`),
}
