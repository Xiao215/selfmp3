import { z } from 'zod'
import { DEFAULT_APP_URL } from './cloud.js'

/**
 * The extension as a way through CORS for the page, and nothing more
 * (docs/features/client-download.md).
 *
 * The page runs youtubei.js — everything that has to follow YouTube's changes
 * ships with the page, which updates on every deploy — and the extension only
 * carries its requests: it knows nothing about players, formats or tokens, so
 * it has no reason to change when YouTube does. The two sides speak this
 * protocol over a `chrome.runtime` port, and both check every message against
 * these schemas.
 *
 * A carrier like this hands the page a cross-origin `fetch`, so what it will
 * carry is held to YouTube's own hosts, and it sends no cookies: without them
 * it can do nothing a server-side proxy could not, and a script that got into
 * the page cannot act as the person on YouTube. The one exception is the
 * person's own: "Use my YouTube sign-in", off unless they turn it on in the
 * extension, and then only on the player request (`signsIn`).
 */

/** The port's name: `chrome.runtime.connect(EXTENSION_ID, { name })`. */
export const YT_PROXY_PORT = 'yt-proxy'

/**
 * Bytes per message, each way. Chrome serializes a message as JSON, so bytes
 * cross as base64; a megabyte is a few messages a song and none too big to
 * build at once.
 */
export const YT_PROXY_CHUNK_BYTES = 1024 * 1024

/**
 * The pages that may open the port, by where their address starts: the app's
 * own path, not all of the site it is published on — `xiao215.github.io` holds
 * more than self.mp3. The manifest's `externally_connectable` says the same
 * (each with `*` after it) and is what Chrome enforces; this list is the
 * extension checking it again, and the manifest's test holds the two together.
 *
 * The path is a check on the address, not a wall: a page elsewhere on the
 * same site shares the app's origin, so it can open the app's page in a
 * window and connect from inside it — as it can read the app's storage, its
 * self.mp3 session among it, outright. Only the app on an origin of its own
 * (its own domain) would make the origin check the lock it looks like.
 *
 * Port 4601 is `npm run dev:web`; 4602 is the client download harness
 * (packages/ytclient). The extension's release zip leaves both out of its
 * manifest (apps/extension/scripts/zip.mjs), and Chrome keeps every other
 * page from connecting.
 */
export const YT_PROXY_PAGES: readonly string[] = [
  `${DEFAULT_APP_URL}/`,
  'http://localhost:4601/',
  'http://localhost:4602/',
]

/** Whether the page at `url` may open the port (`YT_PROXY_PAGES`). */
export function isYtProxyPage(url: string, pages: readonly string[] = YT_PROXY_PAGES): boolean {
  return pages.some(page => url.startsWith(page))
}

/** Hosts the carrier will reach, whole. */
const HOSTS = new Set([
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  // youtubei.js asks InnerTube here for some of its clients.
  'youtubei.googleapis.com',
])

/**
 * Whether the carrier may fetch `url` for the page: YouTube's own hosts, its
 * media hosts, and on www.google.com only the folder BotGuard's interpreter is
 * served from — google.com itself is far more than YouTube.
 */
export function isYtProxyUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return false
  }
  const host = parsed.hostname
  if (HOSTS.has(host)) return true
  if (host.endsWith('.googlevideo.com')) return true
  return host === 'www.google.com' && parsed.pathname.startsWith('/js/th/')
}

const HeadersSchema = z.array(z.tuple([z.string().max(200), z.string().max(20_000)])).max(100)

/** What the page sends. */
export const YtProxyPageMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('request'),
    id: z.number().int().nonnegative(),
    url: z.string().max(20_000),
    method: z.enum(['GET', 'HEAD', 'POST']),
    headers: HeadersSchema,
    /** The body, base64. A player request is a few kilobytes; nothing sent is a song. */
    body: z
      .string()
      .max(4 * 1024 * 1024)
      .nullable(),
  }),
  /** The page gave up on a request: the extension stops reading it. */
  z.object({ type: z.literal('abort'), id: z.number().int().nonnegative() }),
])
export type YtProxyPageMessage = z.infer<typeof YtProxyPageMessageSchema>

/** What the extension sends back: a head, its body in chunks, then an end — or an error. */
export const YtProxyExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('head'),
    id: z.number().int().nonnegative(),
    status: z.number().int().min(200).max(599),
    statusText: z.string(),
    headers: HeadersSchema,
  }),
  z.object({ type: z.literal('chunk'), id: z.number().int().nonnegative(), data: z.string() }),
  z.object({ type: z.literal('end'), id: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('error'),
    id: z.number().int().nonnegative(),
    message: z.string(),
  }),
])
export type YtProxyExtensionMessage = z.infer<typeof YtProxyExtensionMessageSchema>

/** Bytes as base64, in slices: one `fromCharCode` over a megabyte overflows the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Whether the carrier sends `url` signed in, when the person has turned that
 * on in the extension's options (docs/features/client-download.md, "Signed
 * in"): the player request, and nothing else. It is the one that YouTube
 * counts against the account rather than the address — what signing in is
 * for — and it changes nothing on the account; the media itself needs no
 * sign-in, and nothing that could like, subscribe or comment is ever sent
 * with one.
 */
export function signsIn(url: string): boolean {
  return /^https:\/\/(www|music)\.youtube\.com\/youtubei\/v1\/player(\?|$)/.test(url)
}

/**
 * The `Authorization` a signed-in request to InnerTube carries, as YouTube's
 * own pages and youtubei.js make it: `SAPISIDHASH <time>_<sha1>`, the SHA-1
 * of the time, the `SAPISID` cookie and YouTube's origin.
 */
export async function sapisidHash(sapisid: string, seconds: number): Promise<string> {
  const input = new TextEncoder().encode(`${seconds} ${sapisid} https://www.youtube.com`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `SAPISIDHASH ${seconds}_${hex}`
}
