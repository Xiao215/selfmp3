import { ImportRequestListSchema, ImportRequestViewSchema } from '@selfmp3/replica'
import {
  IdSchema,
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
  /** Begin a Google sign-in: the worker writes the attempt down and hands back the URL to open. */
  z.object({ type: z.literal('signIn') }),
  z.object({ type: z.literal('claimSignIn'), code: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('signOut') }),
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
  /** Leave the link in the bucket for the server to take when it next wakes (I3). */
  z.object({
    type: z.literal('requestImport'),
    url: z.string().trim().min(1).max(20_000),
    tagIds: z.array(IdSchema).max(50).default([]),
    playlistId: IdSchema.nullable().default(null),
  }),
  z.object({ type: z.literal('requests') }),
  z.object({ type: z.literal('cancelRequest'), uid: z.string().min(1).max(100) }),
])
export type BridgeRequest = z.output<typeof BridgeRequestSchema>
export type RequestType = BridgeRequest['type']

/**
 * Where the extension imports to right now (I3).
 *
 * `server` is the one answering — a typed-in address, or one the bucket's
 * snapshot named — and it is null in bucket mode, where there is no server to
 * name. `away` is the one case with a server and no way through: an address
 * that was typed in, asleep, with no account to fall back to.
 */
export const StatusSchema = z.object({
  mode: z.enum(['none', 'server', 'away', 'bucket']),
  /** The server this is about, if any. The token itself never leaves the worker. */
  server: z.object({ baseUrl: z.string(), typed: z.boolean() }).nullable(),
  /** The Google account signed in to the bucket, by the address it signed in with. */
  account: z.string().nullable(),
  /** How many songs the library holds, from whichever side answered. */
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
  signIn: z.object({ url: z.string() }),
  claimSignIn: StatusSchema,
  signOut: StatusSchema,
  preview: ImportPreviewSchema,
  choices: ChoicesSchema,
  songFor: SongHitSchema.nullable(),
  enqueue: ImportEnqueueResultSchema,
  queue: ImportQueueSchema,
  cancel: OkSchema,
  retry: OkSchema,
  requestImport: ImportRequestViewSchema,
  requests: ImportRequestListSchema,
  cancelRequest: OkSchema,
} satisfies Record<RequestType, z.ZodTypeAny>

export type Reply<T extends RequestType> = z.output<(typeof REPLIES)[T]>

/** The worker's side of each request, typed by what it must answer. */
export type Handlers = {
  [T in RequestType]: (
    request: Extract<BridgeRequest, { type: T }>,
  ) => Promise<z.input<(typeof REPLIES)[T]>>
}

/**
 * The other channel: what a content script may ask, which is far less than a
 * page of the extension may.
 *
 * A content script runs inside youtube.com, so it is treated as that: it can
 * say "this link, please" and be told what the pill should show. It is never
 * told the server's address or its token, never offered the tags or the
 * playlists, and cannot change what an import is tagged with.
 */
export const PageRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pillState'), url: z.string().max(2000) }),
  z.object({ type: z.literal('pillImport'), url: z.string().max(2000) }),
])
export type PageRequest = z.output<typeof PageRequestSchema>

export const PillStateSchema = z.object({
  /** `waiting`: left in the bucket, for the server to take when it wakes (I3). */
  state: z.enum(['idle', 'have', 'importing', 'waiting', 'added', 'failed']),
  /** 0 to 100 while downloading, null otherwise. */
  progress: z.number().min(0).max(100).nullable(),
  /** The job, while it can still be cancelled. */
  jobId: z.string().nullable(),
  message: z.string().nullable(),
})
export type PillState = z.infer<typeof PillStateSchema>

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

/**
 * The worker's side of the content script's channel: the same envelope, a much
 * smaller question, and a reply that says only what the pill draws.
 */
export function servePage(
  handle: (request: PageRequest) => Promise<PillState>,
  explain: (error: unknown) => { message: string; status: number },
): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (reply: Envelope) => void,
    ) => {
      // From a tab, which is what a content script is. The extension's own
      // pages go to `serve` above.
      if (sender.id !== chrome.runtime.id || !sender.tab) return false
      const parsed = PageRequestSchema.safeParse(message)
      if (!parsed.success) return false
      handle(parsed.data).then(
        value => sendResponse({ ok: true, value }),
        (error: unknown) => sendResponse({ ok: false, ...explain(error) }),
      )
      return true
    },
  )
}
