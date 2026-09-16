/**
 * The listening outbox: plays and skips that have not reached the server yet.
 *
 * Every client reports a play the moment it counts, and with the server asleep
 * that request fails. Swallowing the failure would lose every song heard on a
 * train from play counts, stats, Wrapped and forgotten gems — exactly the
 * listening this app exists for — so each event is written to the device first
 * and sent from there.
 *
 * This file is the platform-free half: the event shape, how one failed send is
 * judged, and the flush loop. Where the queue is kept (IndexedDB on the web, a
 * file on the phone) is each client's business.
 */

interface OutboxPlay {
  readonly kind: 'play'
  /** Doubles as the server-side `clientId`, which is what makes a resend safe. */
  readonly id: string
  readonly songId: number
  readonly msPlayed: number
  readonly completed: boolean
  /** ISO 8601, taken when the play counted rather than when it was sent. */
  readonly playedAt: string
}

interface OutboxSkip {
  readonly kind: 'skip'
  readonly id: string
  readonly songId: number
  readonly atSeconds: number
  readonly at: string
}

export type OutboxEvent = OutboxPlay | OutboxSkip

/**
 * What to do with an event after one attempt to send it.
 *
 * - `sent`: the server has it; forget it.
 * - `drop`: the server will never accept it (the song was deleted, or the body
 *   is malformed); forget it rather than retry it forever.
 * - `retry`: the server could not be reached or had a bad moment; keep it and
 *   stop this flush — the next event would only fail the same way.
 */
export type SendOutcome = 'sent' | 'drop' | 'retry'

/**
 * Judge one send by its HTTP status. Status 0 is the clients' convention for
 * "no response at all", which almost always means the server is asleep.
 */
export function outcomeForStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) {
    // 401 included: a token being changed is a setup moment, not a verdict on
    // the play itself.
    return 'retry'
  }
  return 'drop'
}

interface FlushResult {
  /** Events still waiting, oldest first. */
  readonly remaining: OutboxEvent[]
  readonly sent: number
  readonly dropped: number
}

/**
 * Send events oldest first, stopping at the first one that has to wait.
 *
 * Order is kept on purpose: a play and a later skip of the same song arrive in
 * the order they happened, and "last played" only ever moves forward.
 */
export async function flushOutbox(
  events: readonly OutboxEvent[],
  send: (event: OutboxEvent) => Promise<SendOutcome>,
): Promise<FlushResult> {
  let sent = 0
  let dropped = 0

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (!event) continue

    let outcome: SendOutcome
    try {
      outcome = await send(event)
    } catch {
      outcome = 'retry'
    }

    if (outcome === 'retry') return { remaining: events.slice(index), sent, dropped }
    if (outcome === 'sent') sent++
    else dropped++
  }

  return { remaining: [], sent, dropped }
}

/** Past this many waiting events the oldest go: a bound, not a real limit. */
export const OUTBOX_MAX_EVENTS = 5000
/** A play older than this is not going to be missed from anyone's stats. */
const OUTBOX_MAX_AGE_DAYS = 400

/**
 * Keep the queue bounded.
 *
 * A device that never sees its server again should not grow a queue forever.
 * The caps are generous — five thousand plays is months of listening — so in
 * practice nothing real is ever trimmed.
 */
export function trimOutbox(events: readonly OutboxEvent[], now = Date.now()): OutboxEvent[] {
  const cutoff = now - OUTBOX_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  const fresh = events.filter(event => {
    const time = Date.parse(event.kind === 'play' ? event.playedAt : event.at)
    return Number.isNaN(time) || time >= cutoff
  })
  return fresh.length > OUTBOX_MAX_EVENTS ? fresh.slice(fresh.length - OUTBOX_MAX_EVENTS) : fresh
}

/** Drop anything that does not look like an event — the store is not trusted. */
export function parseOutbox(value: unknown): OutboxEvent[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is OutboxEvent => {
    if (typeof item !== 'object' || item === null) return false
    const event = item as Record<string, unknown>
    if (typeof event['id'] !== 'string' || typeof event['songId'] !== 'number') return false
    if (event['kind'] === 'play') {
      return (
        typeof event['msPlayed'] === 'number' &&
        typeof event['completed'] === 'boolean' &&
        typeof event['playedAt'] === 'string'
      )
    }
    if (event['kind'] === 'skip') {
      return typeof event['atSeconds'] === 'number' && typeof event['at'] === 'string'
    }
    return false
  })
}

/**
 * An id unique enough to tell one device's plays apart.
 *
 * Not `crypto.randomUUID`: React Native's engine does not have it, and this
 * only has to be unique among the plays one person makes, not globally.
 */
export function makeOutboxId(now = Date.now(), random: () => number = Math.random): string {
  let suffix = ''
  for (let i = 0; i < 12; i++) suffix += Math.floor(random() * 36).toString(36)
  return `${now.toString(36)}-${suffix}`
}
