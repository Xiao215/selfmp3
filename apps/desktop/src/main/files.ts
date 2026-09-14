import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'

import { app, net, shell } from 'electron'
import type { DownloadRequest, DownloadResult, FileKind, FileStat, Usage } from '@selfmp3/desktop-bridge'

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

async function pathFor(kind: FileKind, name: string): Promise<string> {
  const root = directoryFor(kind)
  await mkdir(root, { recursive: true })
  const resolved = resolveWithinRoot(root, `/${name}`)
  if (resolved === null) throw new Error(`refusing to touch ${name}`)
  return resolved
}

/** Downloads in flight, so `cancel` has something to abort. */
const running = new Map<string, AbortController>()

export async function download(
  request: DownloadRequest,
  onProgress: (bytesWritten: number, totalBytes: number) => void,
): Promise<DownloadResult> {
  const target = await pathFor(request.kind, request.name)
  const part = `${target}.part`

  const resumeFrom = request.resumeFrom ?? (await sizeOf(part))
  const controller = new AbortController()
  running.set(request.id, controller)

  try {
    const headers: Record<string, string> = { ...request.headers }
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`

    const response = await net.fetch(request.url, { headers, signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} from ${hostOf(request.url)}`)

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
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        sink.write(Buffer.from(value))
        written += value.byteLength
        onProgress(written, totalBytes)
      }
    } finally {
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
  const target = await pathFor(kind, name)
  const response = await net.fetch(url, { headers: headers ?? {} })
  if (!response.ok) throw new Error(`${response.status} from ${hostOf(url)}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const part = `${target}.part`
  await new Promise<void>((resolve, reject) => {
    const sink = createWriteStream(part)
    sink.on('error', reject)
    sink.end(bytes, () => resolve())
  })
  await rename(part, target)
}

export async function remove(kind: FileKind, name: string): Promise<void> {
  const target = await pathFor(kind, name)
  await rm(target, { force: true })
  await rm(`${target}.part`, { force: true })
}

export async function statOne(kind: FileKind, name: string): Promise<FileStat> {
  const target = await pathFor(kind, name)
  const bytes = await sizeOf(target)
  return bytes === 0 && !(await exists(target)) ? null : { name, bytes }
}

export async function list(kind: FileKind): Promise<{ name: string; bytes: number }[]> {
  const root = directoryFor(kind)
  await mkdir(root, { recursive: true })
  const entries = await readdir(root, { withFileTypes: true })
  const out: { name: string; bytes: number }[] = []
  for (const entry of entries) {
    // A `.part` is an unfinished download, not a file anyone has.
    if (!entry.isFile() || entry.name.endsWith('.part')) continue
    out.push({ name: entry.name, bytes: await sizeOf(join(root, entry.name)) })
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
  shell.showItemInFolder(await pathFor(kind, name))
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** For an error message, because a URL with a token in it should not be one. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the server'
  }
}
