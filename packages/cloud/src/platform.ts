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
 * `apps/server/src/cloud/store.ts` already uses for the bucket, and for the
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
  randomBytes(into: Uint8Array): void

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
}
