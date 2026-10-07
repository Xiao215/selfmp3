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
 * Plays, held on this device until the server has them.
 *
 * Written down first and sent from there, rather than sent the moment it
 * counts and dropped if the server does not answer — which on a phone is most
 * of the time the app is actually used, and on a laptop any time the server is
 * asleep. The server recognises a resent play by its id, so sending twice is
 * harmless.
 *
 * Every client needs the same rules over different storage — IndexedDB in
 * the browser and a JSON file on the phone — so what is here is everything
 * except the storage, which arrives as an `OutboxStore`.
 *
 * There is deliberately no early return for "no server configured": with no
 * server configured the API client throws an offline `ApiError`, every event
 * comes back `retry`, and nothing is lost.
 */

/*
 * Function-typed properties rather than methods, so that destructuring one off
 * — which is how the app re-exports them — carries no `this`. None of them has
 * one to lose.
 */
export interface ListenOutbox {
  /** A play that has just counted. Stored first, then sent. */
  readonly recordListen: (songId: number, msPlayed: number, completed: boolean) => void
  /** Send what is waiting. Resolves to how many events the server took. */
  readonly flushListens: () => Promise<number>
}

export function createListenOutbox(store: OutboxStore): ListenOutbox {
  /**
   * Storage can be missing or refuse — private browsing, a full disk, an
   * unreadable file. The events then live in memory for this session, which is
   * no worse than before, when they were not kept at all.
   */
  let memoryFallback: OutboxEvent[] | null = null

  async function change(fn: (events: OutboxEvent[]) => OutboxEvent[]): Promise<OutboxEvent[]> {
    if (memoryFallback === null) {
      try {
        return await store.update(current => trimOutbox(fn(parseOutbox(current))))
      } catch {
        memoryFallback = []
      }
    }
    memoryFallback = trimOutbox(fn(memoryFallback))
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
      await clientApi().recordPlay(event.songId, {
        msPlayed: event.msPlayed,
        completed: event.completed,
        playedAt: event.playedAt,
        clientId: event.id,
      })
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
    flushListens,
  }
}
