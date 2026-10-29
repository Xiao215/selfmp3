import { BotGuardClient, getChallenge } from 'bgutils-js/botguard'
import { WebPoMinter } from 'bgutils-js/webpo'
import { buildURL, getHeaders } from 'bgutils-js/utils'
import type { YtFetch } from './transport.js'

/**
 * Proof of Origin tokens, made the way YouTube's own web player makes them.
 *
 * Without one, YouTube's media servers give a web client the first megabyte or
 * so of a song and then answer 403. A token is BotGuard's verdict on the page
 * it ran in, so it has to be made in a browser — which is the one thing a page
 * has that a server does not. bgutils-js does the talking to BotGuard; the
 * requests it makes go through the same carrier as every other.
 *
 * The media servers want a token bound to the video, not to the visitor: one
 * minted for the session's visitor data was refused at the first megabyte as
 * surely as none at all (2026-10-13, and yt-dlp's PO Token Guide says the
 * same). So BotGuard is started once and kept, and mints one per song.
 */

/** The request key YouTube's web player asks BotGuard with. */
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'

export interface PoMinter {
  /** A token bound to `contentBinding`: for the media servers, the video id. */
  mint(contentBinding: string): Promise<string>
  /** How long YouTube said the integrity token behind it lasts, in seconds. */
  readonly ttlSeconds: number | null
  /** Stop BotGuard. The minter mints nothing after this. */
  close(): Promise<void>
}

/**
 * Run BotGuard's challenge in this page and keep a minter.
 *
 * The interpreter BotGuard sends is run with `new Function`, as YouTube's
 * player runs it with a script tag: a page whose CSP forbids eval cannot do
 * this at all.
 */
export async function createPoMinter(fetch: YtFetch): Promise<PoMinter> {
  const challenge = await getChallenge({
    requestKey: REQUEST_KEY,
    fetchFunction: fetch,
    useYouTubeAPI: true,
  })

  let interpreter = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
  const interpreterUrl =
    challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  if (!interpreter && interpreterUrl) {
    const response = await fetch(
      interpreterUrl.startsWith('//') ? `https:${interpreterUrl}` : interpreterUrl,
    )
    if (!response.ok) throw new Error(`BotGuard's interpreter did not load (${response.status})`)
    interpreter = await response.text()
  }
  if (!interpreter) throw new Error('BotGuard sent no interpreter')
  if (!challenge.program || !challenge.globalName) throw new Error('BotGuard sent no program')

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- BotGuard's own interpreter.
  const start = new Function(interpreter) as () => void
  start()

  const botguard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  })
  try {
    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = []
    const botguardResponse = await botguard.snapshot({ webPoSignalOutput })

    const answer = await fetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    })
    if (!answer.ok) throw new Error(`YouTube would not issue an integrity token (${answer.status})`)
    const issued = (await answer.json()) as [string?, number?, number?, string?]
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = issued
    if (typeof integrityToken !== 'string') {
      throw new Error(`YouTube issued no integrity token: ${JSON.stringify(issued).slice(0, 200)}`)
    }

    const minter = await WebPoMinter.create(
      {
        integrityToken,
        ...(estimatedTtlSecs !== undefined ? { estimatedTtlSecs } : {}),
        ...(mintRefreshThreshold !== undefined ? { mintRefreshThreshold } : {}),
        ...(websafeFallbackToken !== undefined ? { websafeFallbackToken } : {}),
      },
      webPoSignalOutput,
    )
    return {
      mint: binding => minter.mintAsWebsafeString(binding),
      ttlSeconds: estimatedTtlSecs ?? null,
      close: () => botguard.shutdown().catch(() => undefined),
    }
  } catch (error) {
    await botguard.shutdown().catch(() => undefined)
    throw error
  }
}

/** The longest a minter is kept, whatever YouTube says: its player script changes too. */
const MAX_MINTER_MS = 6 * 60 * 60 * 1000

/**
 * How long a minter can be used for: four fifths of what YouTube said its
 * integrity token lasts, so it is made again before YouTube starts refusing
 * the tokens it mints — never more than six hours, and six hours for a
 * minter that does not say.
 */
export function minterLifetimeMs(minter: object | null): number {
  // A session's minter may be the page's (sandbox/frame.ts), which says nothing of its token.
  const ttl = minter && 'ttlSeconds' in minter ? minter.ttlSeconds : null
  return typeof ttl === 'number' && ttl > 0 ? Math.min(ttl * 800, MAX_MINTER_MS) : MAX_MINTER_MS
}
