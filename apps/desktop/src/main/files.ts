import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, net, shell } from 'electron'
import {
  fileNameSchema,
  type DownloadRequest,
  type DownloadResult,
  type FileKind,
  type FileStat,
  type Usage,
} from '@selfmp3/desktop-bridge'

import { resolveWithinRoot } from './paths.js'

/**
 * Songs and covers on disk.
 *
 * The phone's behaviour, on a computer: a file under its real name is always a
 * complete file, and an interrupted one is a `.part` that the next attempt
 * continues from with a `Range:`. Nothing here decides *what* to download —
 * that is the shared queue in `packages/client`, unchanged — only where the
 * bytes go and how they get there.
 *
 * Every path is built here from a kind and a name the schema has already
 * narrowed, and then fenced inside its directory anyway. The renderer is a web
 * page; this is the half with a filesystem.
 */

export function directoryFor(kind: FileKind): string {
  return join(app.getPath('userData'), kind)
}

/** Where a file is, fenced inside its directory. Touches nothing on disk. */
function pathFor(kind: FileKind, name: string): string {
  const resolved = resolveWithinRoot(directoryFor(kind), `/${name}`)
  if (resolved === null) throw new Error(`refusing to touch ${name}`)
  return resolved
}

/**
 * The same, for a write, which needs the directory to exist. Only writes make
 * it: a stat, a delete or a reveal of a file in a folder that is not there has
 * its answer already, and would otherwise `mkdir` on every cover check.
 */
async function writablePathFor(kind: FileKind, name: string): Promise<string> {
  await mkdir(directoryFor(kind), { recursive: true })
  return pathFor(kind, name)
}

/**
 * How often a download tells the page how far it has got: four times a second.
 * A read is a chunk of a few kilobytes, so reporting each was hundreds of IPC
 * messages a second, each parsed in the preload and each re-rendering whatever
 * shows downloads. The last is always sent, so the bar finishes where the file did.
 */
export const PROGRESS_INTERVAL_MS = 250

/** Whether a report is due now, and whether one is owed for the bytes since the last. */
export function progressGate(
  intervalMs: number,
  now: () => number = Date.now,
): { due(): boolean; owed(): boolean } {
  let last = Number.NEGATIVE_INFINITY
  let owed = false
  return {
    due() {
      const at = now()
      if (at - last >= intervalMs) {
        last = at
        owed = false
        return true
      }
      owed = true
      return false
    },
    owed: () => owed,
  }
}

/** Downloads in flight, so `cancel` has something to abort. */
const running = new Map<string, AbortController>()

export async function download(
  request: DownloadRequest,
  onProgress: (bytesWritten: number, totalBytes: number) => void,
): Promise<DownloadResult> {
  const target = await writablePathFor(request.kind, request.name)
  const part = `${target}.part`

  /*
   * Always what is on disk, never an offset the page remembered: the two can
   * disagree after a crash mid-write, and an append that lands at the wrong
   * offset is a song that plays for forty seconds and then stops.
   */
  const resumeFrom = await sizeOf(part)
  const controller = new AbortController()
  running.set(request.id, controller)

  try {
    const headers: Record<string, string> = { ...request.headers }
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`

    const response = await net.fetch(request.url, { headers, signal: controller.signal })
    if (!response.ok) throw new Error(await refusal(response, request.url))

    /*
     * A server that answers 200 to a ranged request is sending the whole file
     * again. Appending that to what is already on disk is how a download
     * silently becomes a corrupt file that plays for forty seconds and then
     * stops, so the `.part` is thrown away and this pass starts over.
     */
    const continuing = resumeFrom > 0 && response.status === 206
    if (resumeFrom > 0 && !continuing) await rm(part, { force: true })

    const declared = Number(response.headers.get('Content-Length') ?? 0)
    const totalBytes = continuing ? resumeFrom + declared : declared

    let written = continuing ? resumeFrom : 0
    const sink = createWriteStream(part, { flags: continuing ? 'a' : 'w' })
    const body = response.body
    if (body === null) throw new Error('no body')

    const reader = body.getReader()
    /*
     * The disk's one listener, on before the first write. A full disk or a
     * pulled volume fails a write that had already returned `true`, so the
     * stream's `error` arrives while this loop is waiting on the network, not
     * on `drain` — and an `error` nobody is listening for is an uncaught
     * exception in the main process: the app, not the download. Every wait
     * below is raced against this, so the disk failing ends the download the
     * way a bad response does, with a rejection the page hears about. The
     * reader is cancelled too, or the network would keep pulling the rest of
     * the song into a queue nothing reads from.
     */
    const failed = new Promise<never>((_, reject) => {
      sink.on('error', error => {
        reject(error)
        void reader.cancel(error).catch(() => {})
      })
    })
    // Only the race below wants this rejection; on its own it is not "unhandled".
    failed.catch(() => {})

    const report = progressGate(PROGRESS_INTERVAL_MS)
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), failed])
        if (done) break
        /*
         * `write` returning false is the disk saying it is behind. Reading on
         * regardless holds the rest of the song in memory until it catches up
         * — on a fast network and a slow disk, most of the song. Waiting for
         * `drain` lets the network wait instead.
         */
        if (!sink.write(Buffer.from(value))) await Promise.race([once(sink, 'drain'), failed])
        written += value.byteLength
        if (report.due()) onProgress(written, totalBytes)
      }
    } finally {
      // Where it really stopped — finished, paused or failed — not where the last report happened to be.
      if (report.owed()) onProgress(written, totalBytes)
      await new Promise<void>(resolve => sink.end(resolve))
    }

    // Only now is it a song. Renaming last is what makes "the file exists"
    // mean "the file is whole" everywhere else in the app.
    await rename(part, target)
    return { state: 'done', bytes: written }
  } catch (error) {
    if (controller.signal.aborted) {
      // The `.part` stays: that is the whole point of pausing.
      return { state: 'cancelled', bytes: await sizeOf(part) }
    }
    throw error
  } finally {
    running.delete(request.id)
  }
}

export function cancel(id: string): void {
  running.get(id)?.abort()
}

/** A whole small file with no progress: covers. */
export async function fetchTo(
  kind: FileKind,
  name: string,
  url: string,
  headers?: Record<string, string>,
): Promise<void> {
  const target = await writablePathFor(kind, name)
  const response = await net.fetch(url, { headers: headers ?? {} })
  if (!response.ok) throw new Error(await refusal(response, url))
  await replaceWith(target, Buffer.from(await response.arrayBuffer()))
}

/**
 * The page's own text, in a file of its own: the download index.
 *
 * Through `.part` and a rename, the same as a download, so a relaunch that
 * happens mid-write reads either the old index or the new one and never half
 * of either.
 */
export async function writeText(kind: FileKind, name: string, text: string): Promise<void> {
  await replaceWith(await writablePathFor(kind, name), Buffer.from(text, 'utf8'))
}

/**
 * The whole file at once, through `.part` and a rename, so `target` is only
 * ever the old contents or the new ones.
 */
async function replaceWith(target: string, bytes: Buffer): Promise<void> {
  const part = `${target}.part`
  await writeFile(part, bytes)
  await rename(part, target)
}

export async function remove(kind: FileKind, name: string): Promise<void> {
  const target = pathFor(kind, name)
  await rm(target, { force: true })
  await rm(`${target}.part`, { force: true })
}

export async function statOne(kind: FileKind, name: string): Promise<FileStat> {
  // Outside the `try`: a name that is refused is still an error, not "no file".
  const target = pathFor(kind, name)
  // One stat: it either answers with a size or says there is nothing there.
  try {
    return { name, bytes: (await stat(target)).size }
  } catch {
    return null
  }
}

/**
 * Stats at once, but not all at once: a songs folder of thousands is
 * thousands of stats per usage check, and all of them together would be as
 * many open requests on the libuv pool.
 */
const STAT_BATCH = 32

export async function list(kind: FileKind): Promise<{ name: string; bytes: number }[]> {
  const root = directoryFor(kind)
  await mkdir(root, { recursive: true })
  const entries = await readdir(root, { withFileTypes: true })
  const names: string[] = []
  for (const entry of entries) {
    // A `.part` is an unfinished download, not a file anyone has.
    if (!entry.isFile() || entry.name.endsWith('.part')) continue
    /*
     * Only names the contract admits. This directory is a real directory on
     * someone's computer and other things write to it: `.DS_Store` appears the
     * first time "Reveal in Finder" opens it, and `fileNameSchema` — which the
     * preload parses the whole array against — refuses a leading dot. One such
     * file would make every `files.list` call throw, permanently, losing the
     * app its downloads the moment a person looked at where they were kept. A
     * name the app could never have written is not the page's file, and
     * dropping it here is what makes the listing describe the app's own files.
     */
    if (!fileNameSchema.safeParse(entry.name).success) continue
    names.push(entry.name)
  }
  const out: { name: string; bytes: number }[] = []
  for (let start = 0; start < names.length; start += STAT_BATCH) {
    const batch = names.slice(start, start + STAT_BATCH)
    // In the directory's order, as before: `Promise.all` keeps it.
    out.push(
      ...(await Promise.all(
        batch.map(async name => ({ name, bytes: await sizeOf(join(root, name)) })),
      )),
    )
  }
  return out
}

export async function clear(kind: FileKind): Promise<void> {
  const root = directoryFor(kind)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
}

export async function usage(): Promise<Usage> {
  const [songs, covers] = await Promise.all([list('songs'), list('covers')])
  const total = (files: { bytes: number }[]): number =>
    files.reduce((sum, one) => sum + one.bytes, 0)
  let free = 0
  try {
    const volume = await statfs(app.getPath('userData'))
    free = Number(volume.bavail) * Number(volume.bsize)
  } catch {
    // A filesystem that will not say. Settings shows what is used and no more.
  }
  return { songs: total(songs), covers: total(covers), free: Math.max(0, free) }
}

export async function reveal(kind: FileKind, name?: string): Promise<void> {
  const root = directoryFor(kind)
  await mkdir(root, { recursive: true })
  if (name === undefined) {
    await shell.openPath(root)
    return
  }
  shell.showItemInFolder(pathFor(kind, name))
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** How much of a refusal's body is worth repeating. */
const QUOTED_BYTES = 240

/**
 * A refusal in words: the status and host, and what the answer said — the
 * doorman's `error` for a bucket that would not give the file, or the text
 * of a page. "502 from the doorman" told nobody that the bucket's allowance
 * for the day was used up, which is what the doorman had said.
 */
async function refusal(response: Response, url: string): Promise<string> {
  const head = `${response.status} from ${hostOf(url)}`
  let text = ''
  try {
    text = (await response.text()).slice(0, 16_384)
  } catch {
    return head
  }
  try {
    const parsed: unknown = JSON.parse(text)
    const error = (parsed as { error?: unknown } | null)?.error
    if (typeof error === 'string' && error.trim()) return `${head}: ${error.trim()}`
  } catch {
    // Not JSON: a page, or nothing.
  }
  const words = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUOTED_BYTES)
  return words ? `${head}: ${words}` : head
}

/** For an error message, because a URL with a token in it should not be one. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the server'
  }
}
