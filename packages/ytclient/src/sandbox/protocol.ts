import type { DeviceFile, VideoFacts } from '../keptSongs.js'

/**
 * What the app's page and the sandbox frame say to each other
 * (docs/features/client-download.md, "The sandbox").
 *
 * The frame runs youtubei.js and YouTube's player script in an iframe with
 * `sandbox="allow-scripts"` and nothing else: an origin of its own, with no
 * way to the page's storage, its cookies or its self.mp3 session. BotGuard is
 * the one thing it cannot run: YouTube would not issue an integrity token for
 * a frame with no origin (2026-10-18), so the page runs it and hands the
 * frame each PO token it asks for. It can only ask the page to fetch, and the page only fetches what
 * the extension would carry anyway — YouTube's hosts. The page asks the frame
 * to describe a video or download one, and gets the facts or the file back.
 *
 * Bytes cross as `ArrayBuffer`s handed over, not copied.
 */

/** The frame to the page. */
export type FrameMessage =
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'fetch'
      readonly id: number
      readonly url: string
      readonly method: string
      readonly headers: readonly (readonly [string, string])[]
      readonly body: ArrayBuffer | null
    }
  | { readonly kind: 'abortFetch'; readonly id: number }
  /** A PO token for `binding`, from BotGuard run in the page (sandbox/host.ts). */
  | { readonly kind: 'mint'; readonly id: number; readonly binding: string }
  | { readonly kind: 'progress'; readonly id: number; readonly percent: number }
  | { readonly kind: 'described'; readonly id: number; readonly facts: VideoFacts }
  | { readonly kind: 'downloaded'; readonly id: number; readonly file: DeviceFile }
  | { readonly kind: 'failed'; readonly id: number; readonly message: string }

/** The page to the frame. */
export type PageMessage =
  | { readonly kind: 'describe'; readonly id: number; readonly url: string }
  | { readonly kind: 'download'; readonly id: number; readonly url: string }
  | {
      readonly kind: 'fetched'
      readonly id: number
      readonly status: number
      readonly statusText: string
      readonly headers: readonly (readonly [string, string])[]
      readonly body: ArrayBuffer | null
    }
  | { readonly kind: 'fetchFailed'; readonly id: number; readonly message: string }
  | { readonly kind: 'minted'; readonly id: number; readonly token: string }
  | { readonly kind: 'mintFailed'; readonly id: number; readonly message: string }

/** Whether `value` is an object with a string `kind`: the least a message must be. */
export function isMessage(value: unknown): value is { kind: string; id?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  )
}

/** Statuses whose response may not have a body, which `new Response` enforces. */
export const NULL_BODY = new Set([101, 103, 204, 205, 304])
