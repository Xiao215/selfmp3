import { describe, expect, it } from 'vitest'
import {
  flushOutbox,
  makeOutboxId,
  outcomeForStatus,
  OUTBOX_MAX_EVENTS,
  parseOutbox,
  trimOutbox,
  type OutboxEvent,
  type SendOutcome,
} from './outbox.js'

const play = (id: string, songId = 1, playedAt = '2026-09-01T10:00:00.000Z'): OutboxEvent => ({
  kind: 'play',
  id,
  songId,
  msPlayed: 120_000,
  completed: true,
  playedAt,
})

describe('outcomeForStatus', () => {
  it('keeps anything that might succeed later', () => {
    for (const status of [0, 401, 408, 429, 500, 502, 503]) {
      expect(outcomeForStatus(status)).toBe('retry')
    }
  })

  it('drops what the server will never accept', () => {
    // 404: the song was deleted while the phone was offline.
    for (const status of [400, 404, 422]) expect(outcomeForStatus(status)).toBe('drop')
  })

  it('counts any 2xx as sent', () => {
    expect(outcomeForStatus(200)).toBe('sent')
    expect(outcomeForStatus(204)).toBe('sent')
  })
})

describe('flushOutbox', () => {
  it('sends everything in order when the server is there', async () => {
    const seen: string[] = []
    const result = await flushOutbox([play('a'), play('b'), play('c')], async event => {
      seen.push(event.id)
      return 'sent'
    })
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({ remaining: [], sent: 3, dropped: 0 })
  })

  it('stops at the first retry and keeps it and everything after', async () => {
    const outcomes: Record<string, SendOutcome> = { a: 'sent', b: 'retry', c: 'sent' }
    const seen: string[] = []
    const result = await flushOutbox([play('a'), play('b'), play('c')], async event => {
      seen.push(event.id)
      return outcomes[event.id] ?? 'sent'
    })
    // "c" is never tried: with the Mac asleep it would only fail the same way.
    expect(seen).toEqual(['a', 'b'])
    expect(result.remaining.map(event => event.id)).toEqual(['b', 'c'])
    expect(result.sent).toBe(1)
  })

  it('drops an event the server refuses and carries on', async () => {
    const result = await flushOutbox([play('a'), play('b')], async event =>
      event.id === 'a' ? 'drop' : 'sent',
    )
    expect(result).toEqual({ remaining: [], sent: 1, dropped: 1 })
  })

  it('treats a thrown send as a retry, not a loss', async () => {
    const result = await flushOutbox([play('a')], async () => {
      throw new Error('socket hang up')
    })
    expect(result.remaining).toHaveLength(1)
  })
})

describe('trimOutbox', () => {
  const now = Date.parse('2026-09-10T00:00:00.000Z')

  it('forgets plays older than the cap', () => {
    const kept = trimOutbox(
      [play('old', 1, '2024-01-01T00:00:00.000Z'), play('new', 1, '2026-09-09T00:00:00.000Z')],
      now,
    )
    expect(kept.map(event => event.id)).toEqual(['new'])
  })

  it('keeps the newest when there are too many', () => {
    const many = Array.from({ length: OUTBOX_MAX_EVENTS + 3 }, (_, i) => play(`p${i}`))
    const kept = trimOutbox(many, now)
    expect(kept).toHaveLength(OUTBOX_MAX_EVENTS)
    expect(kept[0]?.id).toBe('p3')
  })
})

describe('parseOutbox', () => {
  it('keeps well-formed events and drops the rest', () => {
    const skip: OutboxEvent = {
      kind: 'skip',
      id: 's',
      songId: 2,
      atSeconds: 4,
      at: '2026-09-01T00:00:00Z',
    }
    const parsed = parseOutbox([play('a'), skip, { kind: 'play', id: 'x' }, null, 'nope'])
    expect(parsed.map(event => event.id)).toEqual(['a', 's'])
  })

  it('reads a missing or corrupt store as empty', () => {
    expect(parseOutbox(undefined)).toEqual([])
    expect(parseOutbox({ not: 'an array' })).toEqual([])
  })
})

describe('makeOutboxId', () => {
  it('fits the server’s clientId bounds and differs between plays', () => {
    const a = makeOutboxId()
    const b = makeOutboxId()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(8)
    expect(a.length).toBeLessThanOrEqual(64)
  })
})
