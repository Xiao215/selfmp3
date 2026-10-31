import { bytesToBase64, youtubeVideoId, messageOf } from '@selfmp3/shared'
import {
  createSession,
  type DEFAULT_CLIENTS,
  downloadAudio,
  extensionFetch,
  type Attempt,
  type DownloadedAudio,
} from '@selfmp3/ytclient'

/**
 * A page to try the client download in, by hand or from
 * packages/ytclient/verify: `npm run harness --workspace @selfmp3/ytclient`.
 */

export interface RunOptions {
  readonly video: string
  readonly clients?: readonly string[]
  readonly poToken?: boolean
  readonly chunkBytes?: number
}

interface Report {
  readonly ok: boolean
  readonly poToken: boolean
  readonly visitorData: string | null
  readonly attempts: readonly Attempt[]
  readonly result: (Omit<DownloadedAudio, 'bytes' | 'attempts'> & { readonly size: number }) | null
  readonly error: string | null
  readonly sessionMs: number
  readonly downloadMs: number
}

declare global {
  interface Window {
    ytHarness: {
      run(options: RunOptions): Promise<Report>
      /** The last download's bytes, base64, for a test to look at. */
      lastBytes(): string | null
    }
  }
}

const log = document.querySelector<HTMLPreElement>('#log')!
const say = (line: string): void => {
  log.textContent += `${line}\n`
  console.warn(line)
}

let lastBytes: Uint8Array | null = null

async function run(options: RunOptions): Promise<Report> {
  log.textContent = ''
  const videoId = youtubeVideoId(options.video) ?? options.video.trim()
  // None named: the download picks them, as the app's does, by what it learns of the sign-in.
  const clients = (options.clients?.length ? options.clients : null) as
    typeof DEFAULT_CLIENTS | null
  const fetch = extensionFetch()
  const empty = { ok: false, visitorData: null, attempts: [], result: null, sessionMs: 0 } as const
  if (!fetch) {
    say('No extension: chrome.runtime is not on this page.')
    return { ...empty, poToken: false, error: 'no extension', downloadMs: 0 }
  }

  const started = performance.now()
  let session
  try {
    say(`Opening a session${options.poToken === false ? ' without a PO token' : ''}…`)
    session = await createSession(fetch, { poToken: options.poToken !== false })
  } catch (error) {
    const message = messageOf(error)
    say(`Session failed: ${message}`)
    return { ...empty, poToken: false, error: message, downloadMs: 0 }
  }
  const sessionMs = Math.round(performance.now() - started)
  say(
    `Visitor ${session.visitorData}, PO tokens ${session.minter ? 'ready' : 'off'} (${sessionMs} ms)`,
  )

  const downloadStarted = performance.now()
  try {
    say(`Downloading ${videoId}, trying ${clients?.join(', ') ?? 'the clients that suit'}…`)
    let shown = -1
    const audio = await downloadAudio(session, videoId, {
      ...(clients ? { clients } : {}),
      ...(options.chunkBytes ? { chunkBytes: options.chunkBytes } : {}),
      onProgress: (received, total) => {
        const percent = Math.floor((received / total) * 100)
        if (percent === shown) return
        shown = percent
        say(`  ${percent}% (${received} / ${total})`)
      },
    })
    const downloadMs = Math.round(performance.now() - downloadStarted)
    for (const attempt of audio.attempts)
      say(`  ${attempt.client}: ${attempt.ok ? 'ok' : 'no'} — ${attempt.detail}`)
    say(
      `Done: “${audio.title}” by ${audio.author}, ${audio.bytes.length} bytes in ${downloadMs} ms`,
    )

    lastBytes = audio.bytes
    const blob = new Blob([audio.bytes], { type: audio.mimeType.split(';')[0] })
    const url = URL.createObjectURL(blob)
    document.querySelector<HTMLAudioElement>('#audio')!.src = url
    const save = document.querySelector<HTMLAnchorElement>('#save')!
    save.href = url
    save.download = `${audio.author} - ${audio.title}.m4a`
    save.hidden = false

    const { bytes, attempts, ...rest } = audio
    return {
      ok: true,
      poToken: session.minter !== null,
      visitorData: session.visitorData,
      attempts,
      result: { ...rest, size: bytes.length },
      error: null,
      sessionMs,
      downloadMs,
    }
  } catch (error) {
    const message = messageOf(error)
    const attempts = (error as { attempts?: Attempt[] }).attempts ?? []
    for (const attempt of attempts) say(`  ${attempt.client}: no — ${attempt.detail}`)
    say(`Failed: ${message}`)
    return {
      ok: false,
      poToken: session.minter !== null,
      visitorData: session.visitorData,
      attempts,
      result: null,
      error: message,
      sessionMs,
      downloadMs: Math.round(performance.now() - downloadStarted),
    }
  }
}

window.ytHarness = {
  run,
  lastBytes: () => (lastBytes ? bytesToBase64(lastBytes) : null),
}

document.querySelector<HTMLFormElement>('#form')!.addEventListener('submit', event => {
  event.preventDefault()
  const clients = document
    .querySelector<HTMLInputElement>('#clients')!
    .value.split(/[\s,]+/)
    .filter(Boolean)
  void run({
    video: document.querySelector<HTMLInputElement>('#video')!.value,
    clients,
    poToken: document.querySelector<HTMLInputElement>('#po')!.checked,
  })
})

/*
 * `?auto&video=…` runs at once and posts the report back to the harness
 * server, for a browser started with no automation attached at all
 * (verify/plainBrowser.mjs): BotGuard can tell when DevTools is driving a page.
 */
const params = new URLSearchParams(location.search)
if (params.has('auto')) {
  const chunk = Number(params.get('chunk') ?? 0)
  void run({
    video: params.get('video') ?? 'fJ9rUzIMcZQ',
    clients: (params.get('clients') ?? '').split(',').filter(Boolean),
    poToken: params.get('po') !== '0',
    ...(chunk ? { chunkBytes: chunk } : {}),
  }).then(report =>
    fetch('/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...report, log: log.textContent }),
    }),
  )
}
