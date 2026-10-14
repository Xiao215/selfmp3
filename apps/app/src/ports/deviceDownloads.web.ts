import {
  IMPORT_META_HEADER,
  IMPORT_SHA256_HEADER,
  ThrottleStateSchema,
  type ThrottleState,
} from '@selfmp3/shared'
import type { DeviceDownloader, DeviceFile } from '@/features/import/deviceImports.model'

/**
 * Downloading a song in this tab (docs/features/client-download.md): the
 * self.mp3 extension carries the page's requests to YouTube, and
 * `@selfmp3/ytclient` does the rest. Loaded only when a song is to be
 * downloaded here — youtubei.js is megabytes nobody else needs — and asked
 * once whether the extension answers; a tab without it imports as it always
 * has, through the server.
 *
 * The installed Mac app draws this same page, but from `app://selfmp3`, which
 * the extension does not talk to: it finds no extension and goes through the
 * server too.
 */
let downloader: Promise<DeviceDownloader | null> | null = null

export function deviceDownloader(): Promise<DeviceDownloader | null> {
  downloader ??= (async () => {
    // Said once, so a person wondering why the server downloads can find out.
    const without = (why: string): null => {
      console.warn(`[device import] songs are downloaded by the server: ${why}`)
      return null
    }
    try {
      const { carrierAnswers, createDeviceDownloader, extensionFetch } =
        await import('@selfmp3/ytclient')
      const fetch = extensionFetch()
      if (!fetch) return without('this browser has no self.mp3 extension to ask YouTube through')
      if (!(await carrierAnswers(fetch))) return without('the self.mp3 extension did not answer')
      return createDeviceDownloader(fetch)
    } catch (error) {
      return without(error instanceof Error ? error.message : String(error))
    }
  })()
  return downloader
}

/** The file, as the body itself, described in the two headers the server reads. */
export async function uploadDeviceFile(
  target: { url: string; headers: Record<string, string> },
  file: DeviceFile,
): Promise<{ status: number; message: string }> {
  const { metaHeader } = await import('@selfmp3/ytclient')
  const response = await fetch(target.url, {
    method: 'PUT',
    headers: {
      ...target.headers,
      'Content-Type': 'audio/mp4',
      [IMPORT_SHA256_HEADER]: file.sha256,
      [IMPORT_META_HEADER]: metaHeader(file.meta),
    },
    body: file.bytes,
  })
  const answer = (await response.json().catch(() => null)) as { error?: unknown } | null
  return {
    status: response.status,
    message: typeof answer?.error === 'string' ? answer.error : '',
  }
}

/**
 * This tab's budget at YouTube (ytBudget.ts), kept in localStorage: an
 * address's standing with YouTube outlasts a reload, and so should the
 * bucket that keeps it in check.
 */
const BUDGET_KEY = 'selfmp3.youtube-budget'
export const deviceBudget = {
  get: (): ThrottleState | null => {
    try {
      const parsed = ThrottleStateSchema.safeParse(
        JSON.parse(localStorage.getItem(BUDGET_KEY) ?? 'null'),
      )
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  },
  save: (state: ThrottleState): void => {
    try {
      localStorage.setItem(BUDGET_KEY, JSON.stringify(state))
    } catch {
      // Storage full or refused: the bucket lasts as long as the tab.
    }
  },
}
