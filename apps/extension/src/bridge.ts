import {
  ImportEnqueueResultSchema,
  ImportEnqueueSchema,
  ImportPreviewSchema,
  ImportQueueSchema,
  PlaylistSchema,
  TagSchema,
} from '@selfmp3/shared'
import { z } from 'zod'

/**
 * The only door between the extension's pages and its background worker.
 *
 * Only the worker talks to a server: it holds the address and the token, where
 * no page of youtube.com can reach them (docs/EXTENSION.md, "Shape"). The popup
 * and the options page ask it through here, and every request and every reply
 * is checked against a schema on both sides — what packages/desktop-bridge does
 * for the desktop app.
 */

export const BridgeRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status') }),
  z.object({
    type: z.literal('connect'),
    baseUrl: z.string().max(2000),
    token: z.string().max(500).nullable(),
  }),
  z.object({ type: z.literal('disconnect') }),
  z.object({ type: z.literal('preview'), url: z.string().trim().min(1).max(20_000) }),
  z.object({ type: z.literal('choices') }),
  z.object({ type: z.literal('songFor'), url: z.string().max(2000) }),
  z.object({
    type: z.literal('enqueue'),
    request: ImportEnqueueSchema,
    /** What the import was of — a playlist's name — for the notification. */
    label: z.string().max(200).nullable().default(null),
  }),
  z.object({ type: z.literal('queue') }),
  z.object({ type: z.literal('cancel'), id: z.string().min(1).max(100) }),
  z.object({ type: z.literal('retry'), id: z.string().min(1).max(100) }),
])
export type BridgeRequest = z.output<typeof BridgeRequestSchema>
export type RequestType = BridgeRequest['type']

/** Where the extension imports to, and whether it answered just now. */
export const StatusSchema = z.object({
  /** Null until a server is connected. The token itself never leaves the worker. */
  server: z.object({ baseUrl: z.string(), hasToken: z.boolean() }).nullable(),
  /** Null when there is no server to ask. */
  reachable: z.boolean().nullable(),
  /** Only when the server said, which it does to a request carrying the token. */
  songCount: z.number().int().nonnegative().nullable(),
})
export type Status = z.infer<typeof StatusSchema>

/** What the popup offers to put an import in. */
export const ChoicesSchema = z.object({
  tags: z.array(TagSchema),
  /** Manual playlists only: an import cannot go into a live one. */
  playlists: z.array(PlaylistSchema),
  /** Tags the server adds to every import (Settings → Importing). */
  defaultTagIds: z.array(z.number().int()),
})
export type Choices = z.infer<typeof ChoicesSchema>

/** A song in the library imported from the same video. */
export const SongHitSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  artist: z.string(),
  addedAt: z.string(),
  playCount: z.number().int().nonnegative(),
})
export type SongHit = z.infer<typeof SongHitSchema>

const OkSchema = z.object({ ok: z.literal(true) })

export const REPLIES = {
  status: StatusSchema,
  connect: StatusSchema,
  disconnect: StatusSchema,
  preview: ImportPreviewSchema,
  choices: ChoicesSchema,
  songFor: SongHitSchema.nullable(),
  enqueue: ImportEnqueueResultSchema,
  queue: ImportQueueSchema,
  cancel: OkSchema,
  retry: OkSchema,
} satisfies Record<RequestType, z.ZodTypeAny>

export type Reply<T extends RequestType> = z.output<(typeof REPLIES)[T]>

/** The worker's side of each request, typed by what it must answer. */
export type Handlers = {
  [T in RequestType]: (
    request: Extract<BridgeRequest, { type: T }>,
  ) => Promise<z.input<(typeof REPLIES)[T]>>
}

export const EnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), message: z.string(), status: z.number().int() }),
])
export type Envelope = z.infer<typeof EnvelopeSchema>

/** A request the worker could not answer: the words to show, and a status (0: no server answered). */
export class BridgeError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'BridgeError'
    this.status = status
  }
}

/** Ask the worker, from a page of the extension. */
export async function ask<T extends RequestType>(
  request: Extract<z.input<typeof BridgeRequestSchema>, { type: T }>,
): Promise<Reply<T>> {
  const checked = BridgeRequestSchema.parse(request)
  const envelope = EnvelopeSchema.parse(await chrome.runtime.sendMessage(checked))
  if (!envelope.ok) throw new BridgeError(envelope.message, envelope.status)
  const schema: z.ZodTypeAny = REPLIES[checked.type]
  return schema.parse(envelope.value) as Reply<T>
}

/** One checked request, to its own handler. Apart from `serve` so a test needs no Chrome. */
export function answer(handlers: Handlers, request: BridgeRequest): Promise<unknown> {
  const handle = handlers[request.type] as (request: BridgeRequest) => Promise<unknown>
  return handle(request)
}

/**
 * The worker's side: answer the extension's own pages, and nothing else. A
 * content script's messages come from inside a page of youtube.com, and are
 * not answered here.
 */
export function serve(
  handlers: Handlers,
  explain: (error: unknown) => { message: string; status: number },
): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (reply: Envelope) => void,
    ) => {
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
        return false
      }
      const parsed = BridgeRequestSchema.safeParse(message)
      if (!parsed.success) {
        sendResponse({
          ok: false,
          message: 'The extension did not understand that request.',
          status: 400,
        })
        return false
      }
      answer(handlers, parsed.data).then(
        value => sendResponse({ ok: true, value }),
        (error: unknown) => sendResponse({ ok: false, ...explain(error) }),
      )
      // Kept open for the answer, which comes after this returns.
      return true
    },
  )
}
