/**
 * Where the shell's files live, and how a request's path becomes one of them.
 *
 * Pure on purpose: this is the part that decides what may be read off disk in
 * answer to something the page asked for, so it is the part that wants tests
 * rather than a running window.
 */
import { normalize, sep } from 'node:path'

/**
 * A path inside `root`, or null.
 *
 * `null` means *serve `index.html`*, not *fail*, everywhere this is used: the
 * export is a single-page app, so `/playlist/1` is a route rather than a file.
 * What it is protecting against is the other case — `..` climbing out of the
 * web root, or an absolute path pretending to be a relative one — because the
 * page asking is a renderer, and a renderer is the thing that gets compromised.
 */
export function resolveWithinRoot(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // A malformed escape is not a path.
    return null
  }
  // A null byte truncates a path for the operating system but not for
  // JavaScript, which is how a prefix check gets talked past.
  if (decoded.includes('\0')) return null

  const withoutLeadingSlash = decoded.replace(/^\/+/, '')
  if (withoutLeadingSlash === '') return null

  const candidate = normalize(`${root}${sep}${withoutLeadingSlash}`)
  const fence = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate.startsWith(fence) ? candidate : null
}

/**
 * The content type for a file the shell serves.
 *
 * Short by design: this list is the export's own file kinds plus the two audio
 * containers the library holds. Anything else is served as bytes, which a
 * browser will not execute — which is the safe way to be wrong.
 */
export function contentTypeFor(path: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  return extension !== undefined && extension in CONTENT_TYPES
    ? (CONTENT_TYPES[extension] as string)
    : 'application/octet-stream'
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  opus: 'audio/ogg',
}
