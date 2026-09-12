import { File, Paths } from 'expo-file-system'
import {
  flushOutbox,
  makeOutboxId,
  outcomeForStatus,
  parseOutbox,
  trimOutbox,
  type OutboxEvent,
  type SendOutcome,
} from '@selfmp3/shared'
import { api, ApiError } from '../api/client'
import type { ServerConnection } from '../server/connection'

/**
 * Plays held on the phone until the Mac has them — the native twin of the web
 * app's `offline/playOutbox.ts`, and the same shared rules underneath.
 *
 * A play used to be sent the moment it counted and dropped if the Mac was
 * asleep, which on a phone is most of the time the app is actually used. Now
 * it is written to a small JSON file first and sent from there; the server
 * recognises a resent play by its id, so sending twice is harmless.
 */

const FILE_NAME = 'listen-outbox.json'

function outboxFile(): File {
  return new File(Paths.document, FILE_NAME)
}

/** One JS thread, one copy: the file is only the durable mirror of this. */
let events: OutboxEvent[] | null = null
let loading: Promise<OutboxEvent[]> | null = null

function load(): Promise<OutboxEvent[]> {
  if (events) return Promise.resolve(events)
  loading ??= (async () => {
    try {
      const file = outboxFile()
      events = file.exists ? parseOutbox(JSON.parse(await file.text())) : []
    } catch {
      // An unreadable file loses what it held, but must not stop new plays.
      events = []
    }
    return events
  })()
  return loading
}

function persist(): void {
  try {
    outboxFile().write(JSON.stringify(events ?? []))
  } catch {
    // The next write carries everything again.
  }
}

async function send(connection: ServerConnection, event: OutboxEvent): Promise<SendOutcome> {
  try {
    if (event.kind === 'play') {
      await api.recordPlay(connection, event.songId, {
        msPlayed: event.msPlayed,
        completed: event.completed,
        playedAt: event.playedAt,
        clientId: event.id,
      })
    } else {
      // The event's own id, so a skip whose response was lost counts once.
      await api.recordSkip(connection, event.songId, event.atSeconds, event.id)
    }
    return 'sent'
  } catch (error) {
    return error instanceof ApiError ? outcomeForStatus(error.status) : 'retry'
  }
}

let flushing: Promise<number> | null = null

/** Send what is waiting. Resolves to how many plays the server took. */
export function flushListens(connection: ServerConnection | null): Promise<number> {
  if (!connection) return Promise.resolve(0)
  flushing ??= (async () => {
    try {
      const snapshot = [...(await load())]
      if (snapshot.length === 0) return 0
      const result = await flushOutbox(snapshot, event => send(connection, event))
      // Removed by id, so a play recorded while this flush was on the network
      // stays in the list.
      const kept = new Set(result.remaining.map(event => event.id))
      const handled = new Set(snapshot.filter(event => !kept.has(event.id)).map(event => event.id))
      events = (events ?? []).filter(event => !handled.has(event.id))
      persist()
      return result.sent
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** A play that has just counted: stored, then sent if the Mac is there. */
export async function recordListen(
  connection: ServerConnection | null,
  songId: number,
  msPlayed: number,
  completed: boolean,
): Promise<void> {
  const list = await load()
  events = trimOutbox([
    ...list,
    {
      kind: 'play',
      id: makeOutboxId(),
      songId,
      msPlayed,
      completed,
      playedAt: new Date().toISOString(),
    },
  ])
  persist()
  void flushListens(connection)
}
