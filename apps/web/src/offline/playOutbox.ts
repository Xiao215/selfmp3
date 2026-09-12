import {
  flushOutbox,
  makeOutboxId,
  outcomeForStatus,
  parseOutbox,
  trimOutbox,
  type OutboxEvent,
  type SendOutcome,
} from '@selfmp3/shared'
import { api, ApiError } from '../lib/api.js'
import { readStored, updateStored } from './mirror.js'

/**
 * Plays and skips, held on this device until the server has them.
 *
 * The player used to send each play straight to the server and swallow the
 * failure, so every song heard with the Mac asleep vanished from play counts,
 * stats and Wrapped. Now a play is written to IndexedDB first and sent from
 * there: immediately when the server answers, otherwise the next time it does.
 * The server recognises a resent play by its id, so sending one twice is safe.
 *
 * The shared half (`@selfmp3/shared/outbox`) owns the flush rules; this file
 * is only storage and the HTTP call.
 */

const OUTBOX_KEY = 'listen-outbox'

type Listener = (pending: number) => void
const listeners = new Set<Listener>()
let pending = 0

/**
 * IndexedDB can be missing or refuse (private browsing, a full disk). The
 * events then live in memory for this session — no worse than before, when
 * they were not kept at all.
 */
let memoryFallback: OutboxEvent[] | null = null

function notify(count: number): void {
  pending = count
  for (const listener of listeners) listener(count)
}

async function change(fn: (events: OutboxEvent[]) => OutboxEvent[]): Promise<OutboxEvent[]> {
  if (memoryFallback === null) {
    try {
      const next = await updateStored(OUTBOX_KEY, current => trimOutbox(fn(parseOutbox(current))))
      notify(next.length)
      return next
    } catch {
      memoryFallback = []
    }
  }
  memoryFallback = trimOutbox(fn(memoryFallback))
  notify(memoryFallback.length)
  return memoryFallback
}

async function read(): Promise<OutboxEvent[]> {
  if (memoryFallback !== null) return memoryFallback
  try {
    return parseOutbox(await readStored(OUTBOX_KEY))
  } catch {
    return []
  }
}

async function send(event: OutboxEvent): Promise<SendOutcome> {
  try {
    if (event.kind === 'play') {
      await api.recordPlay(event.songId, {
        msPlayed: event.msPlayed,
        completed: event.completed,
        playedAt: event.playedAt,
        clientId: event.id,
      })
    } else {
      // The event's own id, so a skip whose response was lost counts once.
      await api.recordSkip(event.songId, event.atSeconds, event.id)
    }
    return 'sent'
  } catch (error) {
    return error instanceof ApiError ? outcomeForStatus(error.status) : 'retry'
  }
}

let flushing: Promise<number> | null = null

/**
 * Send whatever is waiting. Resolves to how many events the server took.
 *
 * Only one flush runs at a time per tab; a call during one joins it. Sent
 * events are removed by id rather than by overwriting the list, so a play
 * recorded mid-flush is never lost.
 */
export function flushListens(): Promise<number> {
  flushing ??= (async () => {
    try {
      const waiting = await read()
      if (waiting.length === 0) return 0
      const result = await flushOutbox(waiting, send)
      const kept = new Set(result.remaining.map(event => event.id))
      const handled = new Set(waiting.filter(event => !kept.has(event.id)).map(event => event.id))
      await change(events => events.filter(event => !handled.has(event.id)))
      return result.sent
    } finally {
      flushing = null
    }
  })()
  return flushing
}

async function add(event: OutboxEvent): Promise<void> {
  await change(events => [...events, event])
  void flushListens()
}

/** A play that has just counted. Stored first, then sent. */
export function recordListen(songId: number, msPlayed: number, completed: boolean): void {
  void add({
    kind: 'play',
    id: makeOutboxId(),
    songId,
    msPlayed,
    completed,
    playedAt: new Date().toISOString(),
  })
}

export function recordSkipListen(songId: number, atSeconds: number): void {
  void add({
    kind: 'skip',
    id: makeOutboxId(),
    songId,
    atSeconds,
    at: new Date().toISOString(),
  })
}

/** How many events are waiting, now and whenever it changes. */
export function subscribePendingListens(listener: Listener): () => void {
  listeners.add(listener)
  listener(pending)
  return () => listeners.delete(listener)
}

/** Load the count once at start-up, before anything has been recorded. */
export async function loadPendingListens(): Promise<number> {
  const events = await read()
  notify(events.length)
  return events.length
}
