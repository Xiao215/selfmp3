import { base64ToBytes } from '@selfmp3/shared'
import type { DeviceFile, VideoFacts, YouTubeCore } from '../keptSongs.js'
import type { AppMessage, PageMessage } from './protocol.js'

/**
 * The phone app's side of its YouTube page (protocol.ts): what the app asks
 * the page, and the page's answers put back together — the facts of a video,
 * or a file from its chunks. Nothing here runs YouTube's code, or knows what a
 * WebView is: the app hands it a way to send and every message that comes
 * back, so a test can stand in for the page.
 */
export interface WebViewCore extends YouTubeCore {
  /** A message from the page, as the WebView's `onMessage` gave it. */
  receive(raw: string): void
  /** Settles once the page has loaded and said so. */
  readonly ready: Promise<void>
  /** The page went (closed, crashed, reloaded): everything waiting on it fails. */
  lost(reason: string): void
}

type Pending =
  | {
      readonly kind: 'describe'
      readonly resolve: (facts: VideoFacts) => void
      readonly reject: (error: Error) => void
    }
  | {
      readonly kind: 'download'
      readonly resolve: (file: DeviceFile) => void
      readonly reject: (error: Error) => void
      readonly onProgress: (percent: number) => void
      readonly chunks: Uint8Array[]
    }

export function createWebViewCore(post: (message: AppMessage) => void): WebViewCore {
  let nextId = 0
  const pending = new Map<number, Pending>()
  let markReady: () => void = () => undefined
  let failReady: (error: Error) => void = () => undefined
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve
    failReady = reject
  })
  // A page that never loads is noticed by whoever waits on `ready`, not by an unhandled rejection.
  ready.catch(() => undefined)

  const settle = (id: number): Pending | undefined => {
    const waiting = pending.get(id)
    pending.delete(id)
    return waiting
  }

  return {
    ready,

    describe(url) {
      return new Promise<VideoFacts>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { kind: 'describe', resolve, reject })
        post({ kind: 'describe', id, url })
      })
    },

    download(url, onProgress) {
      return new Promise<DeviceFile>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { kind: 'download', resolve, reject, onProgress, chunks: [] })
        post({ kind: 'download', id, url })
      })
    },

    receive(raw) {
      let message: PageMessage
      try {
        message = JSON.parse(raw) as PageMessage
      } catch {
        return
      }
      if (message.kind === 'ready') {
        markReady()
        return
      }
      const waiting = pending.get(message.id)
      if (!waiting) return
      switch (message.kind) {
        case 'progress':
          if (waiting.kind === 'download') waiting.onProgress(message.percent)
          return
        case 'described':
          settle(message.id)
          if (waiting.kind === 'describe') waiting.resolve(message.facts)
          return
        case 'chunk':
          if (waiting.kind === 'download') waiting.chunks.push(base64ToBytes(message.data))
          return
        case 'downloaded': {
          settle(message.id)
          if (waiting.kind !== 'download') return
          const bytes = new Uint8Array(new ArrayBuffer(message.size))
          let at = 0
          for (const chunk of waiting.chunks) {
            bytes.set(chunk, at)
            at += chunk.length
          }
          if (at !== message.size) {
            waiting.reject(new Error(`the page sent ${at} of the song's ${message.size} bytes`))
            return
          }
          waiting.resolve({
            bytes,
            mimeType: 'audio/mp4',
            sha256: message.sha256,
            meta: message.meta,
          })
          return
        }
        case 'failed':
          settle(message.id)
          waiting.reject(new Error(message.message))
          return
      }
    },

    lost(reason) {
      failReady(new Error(reason))
      for (const [id, waiting] of pending) {
        pending.delete(id)
        waiting.reject(new Error(reason))
      }
    },
  }
}
