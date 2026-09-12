import {
  flushOutbox,
  makeOutboxId,
  outcomeForStatus,
  parseOutbox,
  trimOutbox,
  type OutboxEvent,
  type SendOutcome,
} from '@selfmp3/shared'

import { ApiError } from '../api/error.js'
import { clientApi } from '../runtime.js'
import type { OutboxStore } from '../platform.js'

/**
 * Plays and skips, held on this device until the server has them.
 *
 * A play used to be sent the moment it counted and dropped if the server did
 * not answer, which on a phone is most of the time the app is actually used and
 * on a laptop is any time the Mac is asleep. Now it is written down first and
 * sent from there; the server recognises a resent play by its id, so sending
 * twice is harmless.
 *
 * Both apps had this file — the same rules over different storage, IndexedDB in
 * the browser and a JSON file on the phone — so what is here is everything
 * except the storage, which arrives as an `OutboxStore`.
 *
 * The phone's version also took the server connection and returned early when
 * there was none. It does not need to: with no server configured the API client
 * throws an offline `ApiError`, every event comes back `retry` and nothing is
 * lost, which is what the early return achieved.
 */

type Listener = (pending: number) => void

/*
 * Function-typed properties rather than methods, so that destructuring one off
 * — which is how both apps re-export them — carries no `this`. None of them has
 * one to lose.
 */
export interface ListenOutbox {
  /** A play that has just counted. Stored first, then sent. */
  readonly recordListen: (songId: number, msPlayed: number, completed: boolean) => void
  readonly recordSkipListen: (songId: number, atSeconds: number) => void
  /** Send what is waiting. Resolves to how many events the server took. */
  readonly flushListens: () => Promise<number>
  /** How many events are waiting, now and whenever it changes. */
  readonly subscribePendingListens: (listener: Listener) => () => void
  /** Load the count once at start-up, before anything has been recorded. */
  readonly loadPendingListens: () => Promise<number>
}

export function createListenOutbox(store: OutboxStore): ListenOutbox {
  const listeners = new Set<Listener>()
  let pending = 0

  /**
   * Storage can be missing or refuse — private browsing, a full disk, an
   * unreadable file. The events then live in memory for this session, which is
   * no worse than before, when they were not kept at all.
   */
  let memoryFallback: OutboxEvent[] | null = null

  function notify(count: number): void {
    pending = count
    for (const listener of listeners) listener(count)
  }

  async function change(fn: (events: OutboxEvent[]) => OutboxEvent[]): Promise<OutboxEvent[]> {
    if (memoryFallback === null) {
      try {
        const next = await store.update(current => trimOutbox(fn(parseOutbox(current))))
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
      return parseOutbox(await store.read())
    } catch {
      return []
    }
  }

  async function send(event: OutboxEvent): Promise<SendOutcome> {
    try {
      if (event.kind === 'play') {
        await clientApi().recordPlay(event.songId, {
          msPlayed: event.msPlayed,
          completed: event.completed,
          playedAt: event.playedAt,
          clientId: event.id,
        })
      } else {
        // The event's own id, so a skip whose response was lost counts once.
        await clientApi().recordSkip(event.songId, event.atSeconds, event.id)
      }
      return 'sent'
    } catch (error) {
      return error instanceof ApiError ? outcomeForStatus(error.status) : 'retry'
    }
  }

  let flushing: Promise<number> | null = null

  /**
   * Only one flush runs at a time; a call during one joins it. Sent events are
   * removed by id rather than by overwriting the list, so a play recorded
   * mid-flush is never lost.
   */
  function flushListens(): Promise<number> {
    flushing ??= (async () => {
      try {
        const waiting = await read()
        if (waiting.length === 0) return 0
        const result = await flushOutbox(waiting, send)
        const kept = new Set(result.remaining.map(event => event.id))
        const handled = new Set(
          waiting.filter(event => !kept.has(event.id)).map(event => event.id),
        )
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

  return {
    recordListen: (songId, msPlayed, completed) => {
      void add({
        kind: 'play',
        id: makeOutboxId(),
        songId,
        msPlayed,
        completed,
        playedAt: new Date().toISOString(),
      })
    },
    recordSkipListen: (songId, atSeconds) => {
      void add({
        kind: 'skip',
        id: makeOutboxId(),
        songId,
        atSeconds,
        at: new Date().toISOString(),
      })
    },
    flushListens,
    subscribePendingListens: listener => {
      listeners.add(listener)
      listener(pending)
      return () => listeners.delete(listener)
    },
    loadPendingListens: async () => {
      const events = await read()
      notify(events.length)
      return events.length
    },
  }
}
