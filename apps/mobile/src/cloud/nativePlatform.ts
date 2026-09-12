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

/** The doorman this build signs in through. */
const doormanUrl =
  (Constants.expoConfig?.extra as { doormanUrl?: string | null } | undefined)?.doormanUrl ??
  DEFAULT_DOORMAN_URL

export const nativePlatform: CloudPlatform = {
  doormanUrl,
  store: documentStore(),
  fetch: (url, init) => fetch(url, init as RequestInit),

  // Hermes has no `crypto.getRandomValues`, and this is the attempt id: one
  // somebody could guess is a session somebody could claim.
  randomBytes: into => into.set(Crypto.getRandomBytes(into.length)),

  /**
   * Null, and that is the whole native sign-in story.
   *
   * There is no page for the doorman to send Google back to, so it shows a
   * code instead and the app asks for it — the same path an iPhone home-screen
   * app already takes when Google opens in a sheet with storage of its own.
   * Nothing in the doorman had to change for this.
   */
  returnUrl: null,
  openSignIn: url => {
    void Linking.openURL(url)
  },

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
