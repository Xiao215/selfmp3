import { library, cloudPlatform, session as cloudSession } from '../replica'
import { createCoverChanges } from './coverChanges'

/**
 * What to do about a cover, without knowing where the bytes go.
 *
 * Both platforms want a cover on the device before it can be shown — `Image`
 * and the lock-screen player are handed a URL and given no chance to attach a
 * header, while the doorman reads the bearer header and nothing else — and
 * both then answer the same questions the same way: which cover is where, one
 * fetch however many rows ask, a failure tried again after a while, a kept
 * server cover in front of a cloud one, and everything forgotten at sign-out.
 *
 * That is this file. What genuinely differs is where a file lives and how it
 * is written, which is `CoverPlatform` — offline/covers.ts fills it in with
 * expo-file-system's directories, offline/covers.web.ts with the `coverFiles`
 * port. The same cut coverChanges.ts made one level down: the policy is
 * shared and tested, anything touching a file is not.
 */

/**
 * The size a server's cover is kept at. A row draws it at 40 points and Now
 * Playing at most at about 360, so 640 pixels is sharp on a 2× screen and soft
 * only on a 3× one at full width; at 40 KB or so it lets a library of
 * thousands be kept.
 */
export const KEPT_COVER_SIZE = 640

/** How long a cover whose fetch failed is left alone before being asked for again. */
const RETRY_FAILED_MS = 30_000

export interface CoverPlatform {
  /**
   * Whether this platform can keep a cover at all. An ordinary browser tab
   * cannot, and every export below becomes the nothing a browser has always
   * done: a cloud library's rows keep their letter tiles, and a server's
   * covers are drawn from the server's own address, which needs no file.
   */
  readonly canKeep: () => boolean
  /**
   * Read what earlier launches kept, once, calling `found` for each.
   *
   * Called synchronously on a phone, where the directory read is synchronous
   * and the first `coversNow()` has to already hold them — otherwise the first
   * render draws the server's address and swaps in the kept file a moment
   * later, a flicker on every cover, every launch. On web the listing is a
   * shell call, so `found` arrives afterwards and is announced instead.
   */
  readonly prime: (found: (songId: number, rev: string, uri: string) => void) => void
  /** Where this device already holds the cloud cover named `name`, if it does. */
  readonly haveCloud: (name: string) => Promise<string | null>
  /** Fetch the cloud cover `name` from `url`; where it now is, or null. May throw. */
  readonly keepCloud: (
    name: string,
    url: string,
    headers: Record<string, string>,
  ) => Promise<string | null>
  /** Keep a server's cover as `name` from `url`; where it now is, or null. May throw. */
  readonly keepServed: (name: string, url: string) => Promise<string | null>
  /** Drop everything this platform is keeping. May throw. */
  readonly forgetFiles: () => Promise<void>
}

export interface CoverStore {
  /** Told which songs' covers changed. */
  readonly subscribeCovers: ReturnType<typeof createCoverChanges>['subscribe']
  /** Bumped once per announcement: how a reader tells it missed one. */
  readonly coversVersion: () => number
  readonly coversNow: () => ReadonlyMap<number, string>
  readonly coverFor: (songId: number) => string | undefined
  readonly ensureServerCover: (
    songId: number,
    rev: string | undefined,
    url: string,
  ) => Promise<void>
  readonly ensureCover: (songId: number) => Promise<string | null>
  readonly forgetCovers: () => Promise<void>
}

/** `4f1c….jpg` from `covers/4f1c….jpg`: the hash is already the name. */
function nameFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/** A server's cover, named so that priming can read the song and revision back. */
function servedName(songId: number, rev: string): string {
  return `${songId}-${rev.replace(/[^a-zA-Z0-9.-]/g, '_')}.jpg`
}

export function createCoverStore(platform: CoverPlatform): CoverStore {
  /** Resolved cloud covers by song id, so a list that re-renders does not re-ask. */
  const known = new Map<number, string | null>()
  /** In-flight fetches, so ten rows appearing at once make one request. */
  const fetching = new Map<number, Promise<string | null>>()
  /** When a cover's fetch last failed, so it is asked for again after a while. */
  const failed = new Map<number, number>()
  /** What this device holds of a server's covers, and the revision each was drawn at. */
  const served = new Map<number, { rev: string; uri: string }>()
  /** Addresses tried this launch: a server that is away is asked once per song, not per render. */
  const tried = new Set<string>()

  /**
   * Whoever wants to know when a cover arrives — the list, mostly — told which
   * songs' covers, a frame's worth at a time (offline/coverChanges.ts).
   */
  const changes = createCoverChanges()

  let primed = false
  /** True only while a platform primes synchronously; see `found` below. */
  let priming = false

  const found = (songId: number, rev: string, uri: string): void => {
    served.set(songId, { rev, uri })
    // A synchronous prime is already in the map the caller is about to read,
    // so there is nothing to tell anyone. One that answers later has missed
    // that read, and whoever is drawn has to hear about it.
    if (!priming) changes.changed(songId)
  }

  const prime = (): void => {
    if (primed || !platform.canKeep()) return
    primed = true
    priming = true
    try {
      platform.prime(found)
    } finally {
      priming = false
    }
  }

  const coversNow = (): ReadonlyMap<number, string> => {
    prime()
    const map = new Map<number, string>()
    for (const [songId, uri] of known) if (uri) map.set(songId, uri)
    for (const [songId, { uri }] of served) map.set(songId, uri)
    return map
  }

  /**
   * One song's entry in `coversNow()`, without copying the rest: a kept server
   * cover before a cloud one, as the map is built.
   */
  const coverFor = (songId: number): string | undefined => {
    prime()
    return served.get(songId)?.uri ?? (known.get(songId) || undefined)
  }

  /**
   * Keep a server's cover on this device, from the address the server serves it
   * at. Safe to call for every visible row: a cover already kept, or an address
   * already tried, costs a map lookup. What is on disk is checked before the
   * network, so a cover kept on an earlier launch is found without the server.
   *
   * Settles when the cover is kept or given up on, so a pass over the whole
   * library can hold how many run at once; a row drawing it need not wait.
   */
  const ensureServerCover = (
    songId: number,
    rev: string | undefined,
    url: string,
  ): Promise<void> => {
    if (!platform.canKeep()) return Promise.resolve()
    prime()
    const revision = rev ?? ''
    const have = served.get(songId)
    if (have && have.rev === revision) return Promise.resolve()
    if (tried.has(url)) return Promise.resolve()
    tried.add(url)
    return (async () => {
      // Off the current frame first. This is called while a row renders, and a
      // cover found on disk would otherwise announce itself — and set state in
      // every list — in the middle of that render.
      await new Promise(resolve => setTimeout(resolve, 0))
      try {
        const uri = await platform.keepServed(servedName(songId, revision), url)
        if (!uri) return
        served.set(songId, { rev: revision, uri })
        changes.changed(songId)
      } catch {
        // The server is away. The address is drawn for now, and asked for again
        // next launch; there is a letter tile behind it either way.
      }
    })()
  }

  /**
   * Make sure a song's cover is on this device, and say where.
   *
   * Safe to call for every visible row on every render: a resolved cover is
   * answered from memory, and a request already in flight is joined rather than
   * repeated.
   */
  const ensureCover = async (songId: number): Promise<string | null> => {
    if (!platform.canKeep()) return null
    if (known.has(songId)) return known.get(songId) ?? null
    const already = fetching.get(songId)
    if (already) return already
    // A fetch that failed is tried again after a while, not never: the bucket
    // had a bad minute once and two covers stayed letter tiles all session.
    const failedAt = failed.get(songId)
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_FAILED_MS) return null

    const work = (async (): Promise<string | null> => {
      try {
        const key = await library.cloudCoverKey(songId)
        if (!key) return null
        const name = nameFromKey(key)
        // The name is the hash of the contents, so a file already there is the
        // right file and nothing goes stale — and it is worth asking before a
        // session is loaded, let alone a request made.
        const have = await platform.haveCloud(name)
        if (have) return have

        const signedIn = await cloudSession.loadSession()
        if (!signedIn) return null

        return await platform.keepCloud(name, `${cloudPlatform.doormanUrl}/v1/files/${key}`, {
          Authorization: `Bearer ${signedIn.token}`,
        })
      } catch (error) {
        // A missing cover is survivable — the letter tile is behind it — but it
        // should not be silent: swallowing this is what made an expo-file-system
        // mistake look like "the bucket has no artwork" for an hour.
        console.warn(
          `self.mp3: could not fetch a cover for song ${songId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return null
      }
    })()

    fetching.set(songId, work)
    const uri = await work
    fetching.delete(songId)
    if (uri) {
      known.set(songId, uri)
      failed.delete(songId)
      changes.changed(songId)
    } else {
      failed.set(songId, Date.now())
    }
    return uri
  }

  /**
   * After signing out: another account's ids mean other songs.
   *
   * `primed` stays set. Whatever was kept is gone once this settles, so there
   * is nothing for a second read to find — and clearing the flag let the next
   * render read the folder *while* the clear was still running, and put back
   * every name about to be deleted.
   */
  const forgetCovers = async (): Promise<void> => {
    known.clear()
    fetching.clear()
    failed.clear()
    served.clear()
    tried.clear()
    try {
      await platform.forgetFiles()
    } catch {
      // Nothing to clear.
    }
  }

  return {
    subscribeCovers: changes.subscribe,
    coversVersion: changes.version,
    coversNow,
    coverFor,
    ensureServerCover,
    ensureCover,
    forgetCovers,
  }
}
