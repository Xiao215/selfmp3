import { library, cloudPlatform, session as cloudSession } from '../cloud'
import { coverFiles } from '../ports/coverFiles'

/**
 * Cover art from the bucket, for the platforms Metro calls web: the installed
 * app, and an ordinary tab.
 *
 * The reason is the same one offline/covers.ts gives for a phone. `Image` and
 * the media session are handed a URL and given no chance to attach a header,
 * while the doorman reads the bearer header and nothing else — so a cover has
 * to be on this device, under a URL of its own, before it can be shown at all.
 *
 * In the installed app it is: `coverFiles` puts it in the shell's covers folder
 * and `app://selfmp3/_media/covers/…` serves it back. In a tab there is no such
 * place, so `coverFiles` is null and every export here becomes the nothing a
 * browser has always done — a cloud library's rows keep their letter tiles, and
 * a Mac's covers are drawn from the Mac's own address, which needs no file.
 */

/** The size a Mac's cover is kept at. The phone's reasoning, and its number. */
export const KEPT_COVER_SIZE = 640

/** Cloud covers by song id, so a list that re-renders does not re-ask. */
const known = new Map<number, string | null>()
/** In-flight fetches, so ten rows appearing at once make one request. */
const fetching = new Map<number, Promise<string | null>>()
/** What this device holds of a Mac's covers, and the revision each was drawn at. */
const served = new Map<number, { rev: string; uri: string }>()
/** Addresses tried this launch: a Mac that is away is asked once per song. */
const tried = new Set<string>()

const listeners = new Set<() => void>()

export function onCoversChanged(run: () => void): () => void {
  listeners.add(run)
  return () => listeners.delete(run)
}

/**
 * Gathered onto one frame: covers arriving from disk at launch would otherwise
 * be one render of every list each.
 */
let announcing = false
function announce(): void {
  if (announcing) return
  announcing = true
  setTimeout(() => {
    announcing = false
    for (const run of listeners) run()
  }, 16)
}

/** `4f1c….jpg` from `covers/4f1c….jpg`: the hash is already the name. */
function nameFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/** A Mac's cover, named so that priming can read the song and revision back. */
function servedName(songId: number, rev: string): string {
  return `${songId}-${rev.replace(/[^a-zA-Z0-9.-]/g, '_')}.jpg`
}

/**
 * Read what earlier launches kept, once. Without this the first render drew the
 * Mac's address and swapped in the kept file a moment later: a flicker on every
 * cover, every launch. The list is asynchronous here — a shell call rather than
 * a directory read — so the swap is announced instead of awaited.
 */
let primed = false
function prime(): void {
  if (primed || !coverFiles) return
  primed = true
  void (async () => {
    try {
      for (const name of await coverFiles.list()) {
        const match = /^(\d+)-(.*)\.jpg$/.exec(name)
        if (match) served.set(Number(match[1]), { rev: match[2] ?? '', uri: coverFiles.uriFor(name) })
      }
      if (served.size > 0) announce()
    } catch {
      // Nothing kept, or nothing readable: the Mac is asked as before.
    }
  })()
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
 * Keep a Mac's cover on this device, from the address the Mac serves it at.
 * Safe to call for every visible row: a cover already kept, or an address
 * already tried, costs a map lookup.
 */
export function ensureServerCover(songId: number, rev: string | undefined, url: string): void {
  const files = coverFiles
  if (!files) return
  prime()
  const revision = rev ?? ''
  const have = served.get(songId)
  if (have && have.rev === revision) return
  if (tried.has(url)) return
  tried.add(url)
  void (async () => {
    // Off the current frame first. This is called while a row renders, and a
    // cover found on disk would otherwise set state in every list in the
    // middle of that render.
    await new Promise(resolve => setTimeout(resolve, 0))
    const name = servedName(songId, revision)
    try {
      if (!(await files.has(name))) await files.keep(name, url)
      served.set(songId, { rev: revision, uri: files.uriFor(name) })
      announce()
    } catch {
      // The Mac is away. The address is drawn for now, and asked for again
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
  const files = coverFiles
  if (!files) return null
  if (known.has(songId)) return known.get(songId) ?? null
  const already = fetching.get(songId)
  if (already) return already

  const work = (async (): Promise<string | null> => {
    try {
      const key = await library.cloudCoverKey(songId)
      if (!key) return null
      const name = nameFromKey(key)
      // The name is the hash of the contents, so a file already there is the
      // right file and nothing goes stale.
      if (await files.has(name)) return files.uriFor(name)

      const signedIn = await cloudSession.loadSession()
      if (!signedIn) return null

      await files.keep(name, `${cloudPlatform.doormanUrl}/v1/files/${key}`, {
        Authorization: `Bearer ${signedIn.token}`,
      })
      return files.uriFor(name)
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
  known.set(songId, uri)
  if (uri) announce()
  return uri
}

/** After signing out: another account's ids mean other songs. */
export function forgetCovers(): void {
  known.clear()
  fetching.clear()
  served.clear()
  tried.clear()
  primed = false
  void coverFiles?.forget().catch(() => undefined)
}
