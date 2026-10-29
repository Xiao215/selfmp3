/*
 * The prebuilt browser bundle, not `youtubei.js/web`: the library's modules
 * import one another in a circle, which esbuild orders and Metro does not —
 * the app's web build failed with "Cannot access 'Platform' before
 * initialization". Bundled into one file, there is no circle left to order.
 */
import { Innertube, Platform } from 'youtubei.js/web.bundle'
import { createPoMinter, type PoMinter } from './poToken.js'
import type { VideoFacts } from './keptSongs.js'
import type { YtFetch } from './transport.js'

/**
 * A song's audio from YouTube, downloaded in the page.
 *
 * The same choice the server's yt-dlp makes (apps/server/src/services/ytdlp.ts):
 * the best m4a, which is what YouTube Music serves and needs no re-encoding.
 * Which InnerTube client is asked decides whether YouTube hands out a link
 * that works at all, and that changes from month to month, so several are
 * tried in turn and every attempt is reported.
 */

type InnerTubeClient = NonNullable<NonNullable<Parameters<Innertube['getBasicInfo']>[1]>['client']>

/**
 * The order clients are tried in, as of 2026-10-13.
 *
 * VISIONOS is the one that gave whole songs: it needs no player script to
 * decipher its links, and its links took a video-bound PO token. MWEB and
 * YTMUSIC gave links that were refused after the first megabyte with a PO
 * token or without one (YTMUSIC's came whole again on 2026-10-29); WEB answers only in SABR, which this does not speak.
 * yt-dlp's own defaults lead with visionos for the same reasons. MWEB stays
 * behind it as the one other client whose links are not SABR.
 */
export const DEFAULT_CLIENTS: readonly InnerTubeClient[] = ['VISIONOS', 'MWEB']

/**
 * The order clients are tried in once the extension signs the player request
 * in (its "Use my YouTube sign-in", docs/features/client-download.md), as of
 * 2026-10-29, tried with a real account.
 *
 * VISIONOS, IOS and ANDROID_VR take no account: a player request really
 * signed in — cookie and `SAPISIDHASH` both — is answered 400 INVALID_ARGUMENT
 * (either alone is taken as signed out). WEB_CREATOR is the other way round:
 * it asks for a sign-in, and signed in gives the whole song, age-restricted
 * ones too. YTMUSIC gives the whole song either way, a music track only.
 * MWEB's links stop at the first megabyte signed in as out, whatever its
 * token is bound to; WEB answers in SABR.
 */
const SIGNED_IN_CLIENTS: readonly InnerTubeClient[] = ['WEB_CREATOR', 'YTMUSIC']

/**
 * Bytes asked for per request. With `range=`, YouTube serves at full speed.
 * A megabyte, because a larger range was now and then refused outright where a
 * megabyte at a time went through.
 */
const DEFAULT_CHUNK_BYTES = 1024 * 1024

/**
 * How many times one client is asked again after its link was refused part
 * way: a fresh link, picking up at the byte the last one stopped. Four of the
 * first 26 downloads met a 403 for no reason the next link shared.
 */
const TRIES_PER_CLIENT = 3

export interface YtSession {
  readonly innertube: Innertube
  readonly fetch: YtFetch
  readonly visitorData: string
  /** Null for a session opened without one, to see what YouTube does then. */
  readonly minter: Pick<PoMinter, 'mint'> | null
  /**
   * Whether the player requests go signed in, as far as YouTube's answers
   * have said. The page cannot see the extension's option, so it learns it
   * (`signInSaid`), and asks the clients that suit (`clientsFor`).
   */
  readonly account: { signedIn: boolean }
}

/** The clients to ask, for what the session knows of its sign-in. */
function clientsFor(session: YtSession): readonly InnerTubeClient[] {
  return session.account.signedIn ? SIGNED_IN_CLIENTS : DEFAULT_CLIENTS
}

/**
 * What a client's failure says of the sign-in, if anything: one that takes
 * no account refuses a signed-in request with a 400, and WEB_CREATOR asks for
 * a sign-in where there is none. Null for any other failure.
 */
function signInSaid(client: InnerTubeClient, detail: string): boolean | null {
  if (/status code 400/.test(detail) && !SIGNED_IN_CLIENTS.includes(client)) return true
  if (client === 'WEB_CREATOR' && /LOGIN_REQUIRED/.test(detail)) return false
  return null
}

/** Take in what a failure said of the sign-in; whether it changed what is known. */
function learn(session: YtSession, client: InnerTubeClient, detail: string): boolean {
  const said = signInSaid(client, detail)
  if (said === null || said === session.account.signedIn) return false
  session.account.signedIn = said
  return true
}

/**
 * Open a session: a visitor identity, BotGuard ready to mint PO tokens, and
 * the player script that deciphers links.
 *
 * The player script is run with `new Function`, as the PO token's interpreter
 * is (poToken.ts).
 */
export async function createSession(
  fetch: YtFetch,
  /**
   * `minter`: where PO tokens come from, when not from BotGuard run here — the
   * sandbox frame asks the page for them, since BotGuard does not attest a
   * frame with no origin of its own (sandbox/frame.ts).
   */
  options: { poToken?: boolean; minter?: Pick<PoMinter, 'mint'> } = {},
): Promise<YtSession> {
  Platform.shim.eval = data => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running YouTube's player is the point.
    const script = new Function(data.output) as () => Record<string, unknown>
    return script()
  }

  const innertube = await Innertube.create({ fetch })
  const visitorData = innertube.session.context.client.visitorData
  if (!visitorData) throw new Error('YouTube gave this session no visitor identity')

  const minter =
    options.poToken === false ? null : (options.minter ?? (await createPoMinter(fetch)))
  return { innertube, fetch, visitorData, minter, account: { signedIn: false } }
}

/** One client asked, and what came of it. */
export interface Attempt {
  readonly client: InnerTubeClient
  readonly ok: boolean
  readonly detail: string
}

export interface DownloadedAudio {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly mimeType: string
  readonly itag: number
  readonly client: InnerTubeClient
  readonly title: string
  readonly author: string
  readonly durationSeconds: number
  /** The video's description: a YouTube Music track's says when it came out (`releaseOf`). */
  readonly description: string
  readonly attempts: readonly Attempt[]
}

/**
 * A video's facts, from one player request — the same request a download
 * makes first. Throws, with YouTube's reason, for a video it will not play
 * here: private, removed, or held back.
 */
export async function describeVideo(session: YtSession, videoId: string): Promise<VideoFacts> {
  const first = clientsFor(session)[0] ?? 'VISIONOS'
  try {
    return await describeWith(session, videoId, first)
  } catch (error) {
    // Refused for a sign-in it did or did not have: once more, with a client that suits.
    if (!learn(session, first, error instanceof Error ? error.message : String(error))) throw error
    return describeWith(session, videoId, clientsFor(session)[0] ?? 'VISIONOS')
  }
}

async function describeWith(
  session: YtSession,
  videoId: string,
  client: InnerTubeClient,
): Promise<VideoFacts> {
  const poToken = session.minter ? await session.minter.mint(videoId) : undefined
  const info = await session.innertube.getBasicInfo(videoId, {
    client,
    ...(poToken ? { po_token: poToken } : {}),
  })
  const playability = info.playability_status
  if (playability?.status !== 'OK') {
    throw new Error(`${playability?.status ?? 'no status'}: ${playability?.reason ?? ''}`.trim())
  }
  const largest = [...(info.basic_info.thumbnail ?? [])].sort((a, b) => b.width - a.width)[0]
  return {
    title: info.basic_info.title ?? '',
    author: info.basic_info.author ?? '',
    durationSeconds: info.basic_info.duration ?? 0,
    description: info.basic_info.short_description ?? '',
    thumbnail: largest?.url ?? null,
  }
}

export async function downloadAudio(
  session: YtSession,
  videoId: string,
  options: {
    clients?: readonly InnerTubeClient[]
    onProgress?: (received: number, total: number) => void
    signal?: AbortSignal
    chunkBytes?: number
  } = {},
): Promise<DownloadedAudio> {
  const attempts: Attempt[] = []
  // Clients asked for by name are asked as they are; otherwise the ones that
  // suit the sign-in — and, once a refusal says it is not as thought, the
  // ones that suit it instead, in place of what was left.
  const clients = [...(options.clients ?? clientsFor(session))]
  let at = 0
  const failed = (client: InnerTubeClient, detail: string): void => {
    attempts.push({ client, ok: false, detail })
    if (options.clients || !learn(session, client, detail)) return
    const asked = new Set(attempts.map(attempt => attempt.client))
    clients.splice(at + 1, clients.length, ...clientsFor(session).filter(next => !asked.has(next)))
  }
  for (; at < clients.length; at++) {
    const client = clients[at] ?? 'VISIONOS'
    // What earlier links of this client already brought in, kept across a refusal.
    let file = null as { bytes: Uint8Array<ArrayBuffer>; received: number } | null
    for (let tries = 0; tries < TRIES_PER_CLIENT; tries++) {
      options.signal?.throwIfAborted()
      try {
        // Bound to this video, and handed to both places youtubei.js reads one
        // from: the player request, and the `pot` the player puts on each link.
        const poToken = session.minter ? await session.minter.mint(videoId) : undefined
        const player = session.innertube.session.player
        if (player) player.po_token = poToken
        const info = await session.innertube.getBasicInfo(videoId, {
          client,
          ...(poToken ? { po_token: poToken } : {}),
        })
        const playability = info.playability_status
        if (playability?.status !== 'OK') {
          const reason = `${playability?.status ?? 'no status'}: ${playability?.reason ?? ''}`
          failed(client, reason.trim())
          break
        }
        const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' })
        const url = await format.decipher(player)
        if (!url) throw new GiveUp('no link to decipher (the client may answer in SABR only)')
        const total = Number(format.content_length ?? 0)
        if (!total) throw new GiveUp('the format does not say how long it is')
        if (file?.bytes.length !== total) file = { bytes: new Uint8Array(total), received: 0 }

        await fetchRanges(session.fetch, url, file, options)
        attempts.push({ client, ok: true, detail: `itag ${format.itag}, ${total} bytes` })
        return {
          bytes: file.bytes,
          mimeType: format.mime_type,
          itag: format.itag,
          client,
          title: info.basic_info.title ?? '',
          author: info.basic_info.author ?? '',
          durationSeconds: info.basic_info.duration ?? 0,
          description: info.basic_info.short_description ?? '',
          attempts,
        }
      } catch (error) {
        if (options.signal?.aborted) throw error
        failed(client, error instanceof Error ? error.message : String(error))
        // Only a refused link is worth another; anything else would fail the same way.
        if (!(error instanceof Refused)) break
      }
    }
  }
  throw Object.assign(
    new Error(
      `no client could download ${videoId}: ` +
        attempts.map(a => `${a.client} — ${a.detail}`).join('; '),
    ),
    { attempts },
  )
}

/** This client cannot give this song: the next client is asked. */
class GiveUp extends Error {}

/** YouTube refused a link part way: the same client, asked again, may give one that works. */
class Refused extends Error {}

/**
 * The rest of the file, a range at a time, into `file` — so a refusal part way
 * leaves what came before it for the next link to build on.
 */
async function fetchRanges(
  fetch: YtFetch,
  url: string,
  file: { bytes: Uint8Array<ArrayBuffer>; received: number },
  options: {
    onProgress?: (received: number, total: number) => void
    signal?: AbortSignal
    chunkBytes?: number
  },
): Promise<void> {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  const total = file.bytes.length
  // Whether the link carries a PO token says which of two failures a 403 is.
  const pot = new URL(url).searchParams.has('pot') ? 'with pot' : 'without pot'
  while (file.received < total) {
    const start = file.received
    const end = Math.min(start + chunkBytes, total) - 1
    const response = await fetch(`${url}&range=${start}-${end}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!response.ok) {
      await response.body?.cancel()
      // Said in the words a rate limit is known by (`isRateLimited`), so it is taken for one.
      const said = response.status === 429 ? ' Too Many Requests' : ''
      throw new Refused(
        `YouTube answered ${response.status}${said} at byte ${start} of ${total} (${pot})`,
      )
    }
    const part = new Uint8Array(await response.arrayBuffer())
    if (part.length !== end - start + 1) {
      throw new Refused(`asked for ${end - start + 1} bytes at ${start}, got ${part.length}`)
    }
    file.bytes.set(part, start)
    file.received += part.length
    options.onProgress?.(file.received, total)
  }
}
