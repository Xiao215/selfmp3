import { Directory, File, Paths } from 'expo-file-system'
import { library, cloudPlatform, session as cloudSession } from '../replica'
import { createCoverChanges } from './coverChanges'

/**
 * Cover art from the bucket, as files this phone can hand to the OS.
 *
 * Artwork cannot be fetched the way everything else is. `Image` and the
 * lock-screen player are handed a URL and given no chance to attach a header,
 * while the doorman reads the bearer header and nothing else — so a cover has
 * to be on the device before it can be shown at all. Which is why, until this
 * existed, every song from the bucket fell back to the coloured first-letter
 * tile: not a design, an absence.
 *
 * Kept in the cache directory and named by the hash already in the key, so two
 * songs sharing an album share one file, nothing ever goes stale, and the OS
 * may reclaim the lot without anything being lost.
 */

const CACHE = new Directory(Paths.cache, 'covers')

/** Resolved covers by song id, so a list that re-renders does not re-ask. */
const known = new Map<number, string | null>()
/** In-flight fetches, so ten rows appearing at once make one request. */
const fetching = new Map<number, Promise<string | null>>()
/** When a cover's fetch last failed, so it is asked for again after a while. */
const failed = new Map<number, number>()
const RETRY_FAILED_MS = 30_000

/**
 * Whoever wants to know when a cover arrives — the list, mostly — told which
 * songs' covers, a frame's worth at a time (offline/coverChanges.ts).
 */
const changes = createCoverChanges()

export function onCoversChanged(run: () => void): () => void {
  return changes.subscribe(() => run())
}

/** `onCoversChanged`, naming the songs whose covers changed. */
export const subscribeCovers = changes.subscribe
/** Bumped once per announcement: how a reader tells it missed one. */
export const coversVersion = changes.version

/**
 * A server's covers, kept beside the songs in the document directory rather than
 * in the cache the OS may reclaim: a song downloaded for the plane wants its
 * picture on the plane too. Named by song and revision, so new art replaces old.
 */
const STORE = new Directory(Paths.document, 'covers')
/**
 * The size a cover is kept at. A row draws it at 40 points and Now Playing at
 * most at about 360, so 640 pixels is sharp on a 2× screen and soft only on a
 * 3× one at full width; at 40 KB or so it lets a library of thousands be kept.
 */
export const KEPT_COVER_SIZE = 640
/** What this device holds of a server's covers, and the revision each was drawn at. */
const served = new Map<number, { rev: string; uri: string }>()
/** Addresses tried this launch: a server that is away is asked once per song, not per render. */
const tried = new Set<string>()

/**
 * Read what earlier launches kept, once, before the first row asks. Without
 * this the first render drew the server's address (or the letter tile, with the
 * server away) and swapped in the kept file a moment later: a flicker on every
 * cover, every launch.
 */
let primed = false
function prime(): void {
  if (primed) return
  primed = true
  try {
    if (!STORE.exists) return
    for (const entry of STORE.list()) {
      const match = /^(\d+)-(.*)\.jpg$/.exec(entry.name)
      if (match && entry instanceof File) {
        served.set(Number(match[1]), { rev: match[2] ?? '', uri: entry.uri })
      }
    }
  } catch {
    // Nothing kept, or nothing readable: the server is asked as before.
  }
}

/** What this device holds right now, as something a screen can keep in state. */
export function coversNow(): ReadonlyMap<number, string> {
  prime()
  const found = new Map<number, string>()
  for (const [songId, uri] of known) if (uri) found.set(songId, uri)
  for (const [songId, { uri }] of served) found.set(songId, uri)
  return found
}

/**
 * One song's entry in `coversNow()`, without copying the rest: a kept server
 * cover before a cloud one, as the map is built.
 */
export function coverFor(songId: number): string | undefined {
  prime()
  return served.get(songId)?.uri ?? (known.get(songId) || undefined)
}

/**
 * Keep a server's cover on this device, from the address the server serves it at.
 * Safe to call for every visible row: a cover already kept, or an address
 * already tried, costs a map lookup. The file is checked before the network,
 * so a cover kept on an earlier launch is found without the server.
 *
 * Settles when the cover is kept or given up on, so a pass over the whole
 * library can hold how many run at once; a row drawing it need not wait.
 */
export function ensureServerCover(songId: number, rev: string | undefined, url: string): Promise<void> {
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
      if (!STORE.exists) STORE.create({ intermediates: true, idempotent: true })
      const file = new File(STORE, `${songId}-${revision.replace(/[^a-zA-Z0-9.-]/g, '_')}.jpg`)
      if (!file.exists) {
        const written = await File.downloadFileAsync(url, file, { idempotent: true })
        if (!written.exists) return
      }
      served.set(songId, { rev: revision, uri: file.uri })
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
export async function ensureCover(songId: number): Promise<string | null> {
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

      if (!CACHE.exists) CACHE.create({ intermediates: true })
      // `covers/4f1c….jpg` → `4f1c….jpg`: the hash is already the name.
      const file = new File(CACHE, key.slice(key.lastIndexOf('/') + 1))
      if (file.exists) return file.uri

      const signedIn = await cloudSession.loadSession()
      if (!signedIn) return null

      // `downloadFileAsync`, not a `DownloadTask`. A task is the right shape
      // for a song — progress, pause, resume — but on iOS it defaults to a
      // *background* URLSession, which is for a few large transfers that
      // outlive the app, not thirteen small ones started in the same frame.
      // Thirteen of them failed as one: `UnableToDownloadException: unknown
      // error`. A cover is one small GET and wants nothing but the bytes.
      //
      // `idempotent` because the name is the hash of the contents: the same
      // file twice is the same file, and racing to write it is not an error.
      const written = await File.downloadFileAsync(
        `${cloudPlatform.doormanUrl}/v1/files/${key}`,
        file,
        { headers: { Authorization: `Bearer ${signedIn.token}` }, idempotent: true },
      )
      return written.exists ? written.uri : null
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

/** After signing out: another account's ids mean other songs. */
export async function forgetCovers(): Promise<void> {
  known.clear()
  fetching.clear()
  failed.clear()
  served.clear()
  tried.clear()
  try {
    if (CACHE.exists) CACHE.delete()
    if (STORE.exists) STORE.delete()
  } catch {
    // Nothing to clear.
  }
}
