import { doormanAuth, doormanFileUrl, library, session as cloudSession } from '../replica'
import { bucketHold } from '@selfmp3/replica'
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

/**
 * The size a cover drawn in a row or a mosaic tile is asked for.
 *
 * Only where nothing is kept — an ordinary browser tab, which keeps no files
 * (offline/covers.web.ts) and draws the server's own address. There a library
 * row at 44 points and a tag's four-cover mosaic at 26 were each pulling the
 * full 640, which is about 40 KB a song of pixels nobody can see. A device
 * that keeps copies keeps them at `KEPT_COVER_SIZE` and draws those, so this
 * changes nothing for it and must not: one file, sharp enough for the page.
 */
export const ROW_COVER_SIZE = 128

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
   * and the first `coverFor()` has to already know them — otherwise the first
   * render draws the server's address and swaps in the kept file a moment
   * later, a flicker on every cover, every launch. On web the listing is a
   * shell call, so `found` arrives afterwards and is announced instead.
   */
  readonly prime: (found: (songId: number, rev: string, uri: string) => void) => void
  /** Where this device already holds the cloud cover named `name`, if it does. */
  readonly haveCloud: (name: string) => Promise<string | null>
  /**
   * The same, answered at once where the platform can look without waiting —
   * a phone's file system can. Left out where it cannot.
   */
  readonly peekCloud?: (name: string) => string | null
  /** Every cloud picture this device keeps, by name. May throw. */
  readonly listCloud: () => Promise<readonly string[]>
  /** Delete the cloud picture `name`. May throw. */
  readonly removeCloud: (name: string) => Promise<void>
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

interface CoverStore {
  /** Told which songs' covers changed. */
  readonly subscribeCovers: ReturnType<typeof createCoverChanges>['subscribe']
  /** Bumped once per announcement: how a reader tells it missed one. */
  readonly coversVersion: () => number
  readonly coverFor: (songId: number) => string | undefined
  /** Whether the last try at a song's cloud cover found nothing to show. */
  readonly coverFailed: (songId: number) => boolean
  readonly ensureServerCover: (
    songId: number,
    rev: string | undefined,
    url: string,
  ) => Promise<void>
  readonly ensureCover: (songId: number) => Promise<string | null>
  /** Told when a picture fetched by key (`ensurePicture`) arrives. */
  readonly subscribePictures: (listener: () => void) => () => void
  /** Bumped once per picture arrived: what a reader compares. */
  readonly picturesVersion: () => number
  /** A bucket picture already on this device, by key — an artist's, which no song id names. */
  readonly pictureFor: (key: string) => string | undefined
  /** Make sure a bucket picture is on this device, by key, and say where. */
  readonly ensurePicture: (key: string) => Promise<string | null>
  /** Delete every bucket picture kept here that `named` does not name; how many went. */
  readonly sweepPictures: (named: ReadonlySet<string>) => Promise<number>
  readonly forgetCovers: () => Promise<void>
}

/** `4f1c….jpg` from `covers/4f1c….jpg`: the hash is already the name. */
function nameFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/** A picture from the bucket, as it is kept: the hash its key is named by, and the extension. */
const BUCKET_PICTURE = /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/

/** A server's cover, named so that priming can read the song and revision back. */
function servedName(songId: number, rev: string): string {
  return `${songId}-${rev.replace(/[^a-zA-Z0-9.-]/g, '_')}.jpg`
}

/** The song and revision a kept server cover was named for, or null for any other file. */
export function parseServedName(name: string): { songId: number; rev: string } | null {
  const match = /^(\d+)-(.*)\.jpg$/.exec(name)
  return match ? { songId: Number(match[1]), rev: match[2] ?? '' } : null
}

/** A cover's file, whatever the bucket's picture was: a cloud cover keeps its own extension. */
export function isPicture(name: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(name)
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
   * Songs whose cloud cover was looked for on the disk and is not there yet.
   * Looking is a file check on the JS thread, asked by every render of every
   * row; it waits here until `ensureCover` has fetched the file or given up.
   */
  const notOnDisk = new Set<number>()
  /** Fetches of bucket pictures by name, covers and artists' alike: one request however many ask. */
  const fetchingFile = new Map<string, Promise<string | null>>()
  /** Bucket pictures asked for by key — artists', which no song id names — by name. */
  const pictures = new Map<string, string>()
  /** When a picture asked for by key last failed, by name. */
  const failedPictures = new Map<string, number>()
  const pictureListeners = new Set<() => void>()
  let picturesSeen = 0

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

  /** The cover kept here for one song: a kept server cover before a cloud one. */
  const coverFor = (songId: number): string | undefined => {
    prime()
    const kept = served.get(songId)?.uri ?? (known.get(songId) || undefined)
    if (kept || known.has(songId)) return kept
    return peek(songId)
  }

  /**
   * A cloud cover already on this device, found in the render that asks for
   * it. The cloud covers are not primed — their names are hashes, not songs —
   * so every cover of every launch used to be a letter tile for the frames it
   * took `ensureCover` to look on disk and announce it, and then a picture:
   * the switch Xiao saw on every list (2026-10-07). The library held in
   * memory already names the file, and a phone can see whether it is there
   * without waiting.
   */
  const peek = (songId: number): string | undefined => {
    if (!platform.peekCloud || !platform.canKeep() || notOnDisk.has(songId)) return undefined
    try {
      const key = library.cloudCoverKeyNow(songId)
      if (!key) return undefined
      const uri = platform.peekCloud(nameFromKey(key))
      if (!uri) {
        notOnDisk.add(songId)
        return undefined
      }
      known.set(songId, uri)
      return uri
    } catch {
      return undefined
    }
  }

  const coverFailed = (songId: number): boolean => failed.has(songId) && !fetching.has(songId)

  /**
   * One bucket picture onto this device, by its key. The name is the hash of
   * the contents, so a file already there is the right file and nothing goes
   * stale — and it is worth asking before a session is loaded, let alone a
   * request made. May throw.
   */
  const keepFile = (key: string): Promise<string | null> => {
    const name = nameFromKey(key)
    const already = fetchingFile.get(name)
    if (already) return already
    const work = (async (): Promise<string | null> => {
      const have = await platform.haveCloud(name)
      if (have) return have
      const signedIn = await cloudSession.loadSession()
      if (!signedIn) return null
      // The bucket refusing for the day: not asked again until the hold is
      // up, however many rows want their cover meanwhile.
      const held = bucketHold('read')
      if (held) throw new Error(held.message)
      return platform.keepCloud(name, doormanFileUrl(key), doormanAuth(signedIn.token))
    })().finally(() => fetchingFile.delete(name))
    fetchingFile.set(name, work)
    return work
  }

  const pictureFor = (key: string): string | undefined => {
    if (!platform.canKeep()) return undefined
    const name = nameFromKey(key)
    const kept = pictures.get(name)
    if (kept) return kept
    try {
      const uri = platform.peekCloud?.(name) ?? null
      if (uri) pictures.set(name, uri)
      return uri ?? undefined
    } catch {
      return undefined
    }
  }

  const ensurePicture = async (key: string): Promise<string | null> => {
    if (!platform.canKeep()) return null
    const name = nameFromKey(key)
    const kept = pictures.get(name)
    if (kept) return kept
    const failedAt = failedPictures.get(name)
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_FAILED_MS) return null
    try {
      const uri = await keepFile(key)
      if (!uri) return null
      pictures.set(name, uri)
      failedPictures.delete(name)
      picturesSeen++
      for (const listener of pictureListeners) listener()
      return uri
    } catch (error) {
      failedPictures.set(name, Date.now())
      console.warn(
        `self.mp3: could not fetch a picture (${name}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  const subscribePictures = (listener: () => void): (() => void) => {
    pictureListeners.add(listener)
    return () => pictureListeners.delete(listener)
  }

  /**
   * Every bucket picture on this device that the library no longer names: a
   * cover since replaced (squared, edited, fixed), a removed song's, an
   * artist's the library has lost. Named by their hash, they are never looked
   * at again once their key is gone from the library, and without this they
   * stayed for good. Only bucket pictures: a server's covers are named by song
   * and revision, and are its business.
   *
   * `named` has to be the whole library's — every song's cover and every
   * artist's picture — or what it leaves out is deleted.
   */
  const sweepPictures = async (named: ReadonlySet<string>): Promise<number> => {
    if (!platform.canKeep()) return 0
    const keep = new Set([...named].map(nameFromKey))
    const gone = new Set<string>()
    for (const name of await platform.listCloud()) {
      if (!BUCKET_PICTURE.test(name) || keep.has(name) || fetchingFile.has(name)) continue
      try {
        await platform.removeCloud(name)
        gone.add(name)
      } catch {
        // Left for the next sweep.
      }
    }
    if (gone.size === 0) return 0
    for (const name of gone) pictures.delete(name)
    // A song whose cover changed while this was open still points at the old
    // file: it is looked for afresh, under the key the library names now.
    for (const [songId, uri] of known) {
      if (uri && gone.has(uri.slice(uri.lastIndexOf('/') + 1))) {
        known.delete(songId)
        notOnDisk.delete(songId)
        changes.changed(songId)
      }
    }
    return gone.size
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
        return await keepFile(key)
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
    // Fetched or given up on: either way the disk is worth a look again.
    notOnDisk.delete(songId)
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
    fetchingFile.clear()
    pictures.clear()
    failedPictures.clear()
    failed.clear()
    served.clear()
    tried.clear()
    notOnDisk.clear()
    try {
      await platform.forgetFiles()
    } catch {
      // Nothing to clear.
    }
  }

  return {
    subscribeCovers: changes.subscribe,
    coversVersion: changes.version,
    coverFor,
    coverFailed,
    ensureServerCover,
    ensureCover,
    subscribePictures,
    picturesVersion: () => picturesSeen,
    pictureFor,
    ensurePicture,
    sweepPictures,
    forgetCovers,
  }
}
