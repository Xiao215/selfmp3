import type { ApiTransport } from '../platform.js'

/**
 * URLs for media. Kept here so nothing else has to know the route shape.
 *
 * Pass the song's `rev` whenever it is known: streams are cached as immutable
 * and covers cache-first, so without it a reused song id plays and shows the
 * old song's file.
 *
 * Unlike the API calls these are not fetched by this package — they are handed
 * to an `<audio>` element, an `<img>`, or `expo-file-system` — so they take the
 * transport directly rather than going through `createApi`.
 */
function withParams(url: string, rev: string | undefined, extra: Record<string, string>): string {
  const params: string[] = []
  if (rev) params.push(`v=${encodeURIComponent(rev)}`)
  for (const [key, value] of Object.entries(extra)) {
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return params.length > 0 ? `${url}?${params.join('&')}` : url
}

export function createMediaUrl(transport: ApiTransport) {
  const media = (): Record<string, string> => transport.mediaParams?.() ?? {}

  return {
    stream: (songId: number, rev?: string) =>
      withParams(transport.url(`/api/stream/${songId}`), rev, media()),
    /** `size`: the longest side wanted; the server snaps it up to one it keeps. Absent, the original. */
    art: (songId: number, rev?: string, size?: number) =>
      withParams(transport.url(`/api/art/${songId}`), rev, {
        ...(size === undefined ? {} : { size: String(size) }),
        ...media(),
      }),
    /**
     * The live event stream; `deviceId` lets commands be addressed to this tab.
     *
     * The token rides in the query string here for the same reason it does for
     * a stream or a cover: `EventSource` cannot be given a header, and neither
     * can the phone's reader, which is handed a URL and nothing else. Without
     * it a server with a token accepts the connection and answers 401 — over
     * and over, because the stream reconnects — which is how presence looked
     * on every device that carries one.
     */
    events: (deviceId: string) =>
      withParams(transport.url('/api/events'), undefined, { deviceId, ...media() }),
    /**
     * A track on the import review screen, before it is imported.
     *
     * The server asks yt-dlp where it lives on YouTube and streams it back, so
     * this only answers where there is a server. It is here rather than in the
     * component that plays it because it is a route, and routes live in one
     * place — the same reason the phase 1 gate greps for stragglers.
     */
    importListen: (url: string) =>
      transport.url(`/api/import/listen?url=${encodeURIComponent(url)}`),
  }
}

export type MediaUrl = ReturnType<typeof createMediaUrl>
