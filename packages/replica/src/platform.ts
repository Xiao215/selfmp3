/**
 * What this package needs of the device it happens to be running on.
 *
 * Everything platform-shaped is named here and implemented by each app: the
 * browser keeps things in IndexedDB and navigates away to sign in; the phone
 * keeps them in its own files and opens a browser. Nothing in this package
 * knows which, so its `tsconfig.json` can go on refusing to load the DOM.
 *
 * The shapes are structural and deliberately small — as much of `fetch` and
 * `Response` as this package ever looks at, and no more — so a browser's real
 * `fetch` satisfies `CloudFetch` by simply being itself, and a test can
 * satisfy it with eight lines. This is the same arrangement
 * `apps/server/src/bucket/store.ts` already uses for the bucket, and for the
 * same reason: the fake is then the cheap thing, not the elaborate thing.
 */

/** As much of a response as anything here reads. */
export interface CloudResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface CloudRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export type CloudFetch = (url: string, init?: CloudRequestInit) => Promise<CloudResponse>

/**
 * Where a device keeps small things between runs — the session, the outbox,
 * this device's copy of the library.
 *
 * `read` answers null for anything never written, and both it and `remove`
 * are expected to be quiet about a device with no storage at all (a private
 * window): losing what was kept is survivable, throwing in the middle of a
 * sign-in is not.
 */
export interface DeviceStore {
  read(key: string): Promise<unknown>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  /**
   * Read, change, write, with nothing getting in between.
   *
   * Not sugar over `read` and `write`: the outbox is changed this way, and two
   * browser tabs share an origin, so a read-then-write pair can lose a change
   * that the other tab made in the gap — or hand out the same log sequence
   * number twice, which is the one thing the bucket's format cannot survive.
   * A browser does this in an IndexedDB transaction. A device with one
   * JavaScript context can simply do the three steps.
   */
  update(key: string, change: (current: unknown) => unknown): Promise<unknown>
}

export interface CloudPlatform {
  /** The doorman this device signs in through. Empty means none is set up. */
  readonly doormanUrl: string
  readonly store: DeviceStore
  readonly fetch: CloudFetch

  /**
   * Cryptographic random, into the bytes given. Not `Math.random`: an attempt
   * id someone can guess is a session someone can claim.
   */
  randomBytes(into: Uint8Array<ArrayBuffer>): void

  /**
   * Where the doorman should send the browser back to when Google is done, or
   * null on a device it cannot return to. A native app is the null case: it
   * reads the code the doorman shows on its own page instead, which is the
   * same path an iPhone home-screen app already takes when Google opens in a
   * sheet whose storage is not the app's.
   */
  readonly returnUrl: string | null

  /** Leave for the doorman's sign-in page — navigate, or open a browser. */
  openSignIn(url: string): void | Promise<void>

  /**
   * What kind of device this is, for its name in the bucket — `iphone`,
   * `browser`, `mac`. Only ever a label: nothing reads it back to decide
   * anything, and two devices of a kind are told apart by the random half of
   * the name.
   */
  readonly deviceKind: string

  /**
   * Run this when the device looks able to reach the bucket again — the
   * network came back, or the app returned to the front. Used to send what is
   * waiting in the outbox without sitting on a timer. A platform with nothing
   * to offer may do nothing; the retry timer still runs.
   */
  onWake(run: () => void): void

  /**
   * Text from the bucket, given its bytes.
   *
   * Snapshots are stored gzip-compressed, and whether they arrive that way
   * depends on the platform — a browser undoes it only when the doorman
   * passes the encoding on, while a native HTTP client inflates transparently
   * and hands over plain bytes. So each platform says how to read them, and
   * the difference stops here.
   */
  decodeText(bytes: Uint8Array): Promise<string>

  /**
   * Somewhere to keep small text files fetched from the bucket — lyrics,
   * named by the hash of their contents, so they never go stale and are there
   * on a plane. Optional: a device without one simply fetches again.
   */
  readonly textCache?: TextCache

  /** Somewhere to say that something was skipped. Optional; console by default. */
  warn?(message: string): void
}

/** Text files from the bucket, kept by key. Keys are content hashes. */
export interface TextCache {
  read(key: string): Promise<string | null>
  write(key: string, text: string): Promise<void>
  clear(): Promise<void>
}
