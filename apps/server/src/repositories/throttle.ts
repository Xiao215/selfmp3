import type { Db } from '../db/index.js'
import { freshState, type ThrottleState } from '../services/ytThrottle.js'

/**
 * The one row that remembers how fast this server may ask YouTube for things.
 *
 * It is a table of its own rather than a few more keys in `settings` because
 * it is not a setting: nobody chooses it, the schema over there would strip
 * keys it does not know, and a budget that has been cut by a block is state
 * the server owns, not preference the user expressed.
 */
export class ThrottleRepository {
  readonly #read
  readonly #write

  constructor(db: Db) {
    this.#read = db.prepare<[], Row>('SELECT * FROM yt_throttle WHERE id = 1')
    this.#write = db.prepare(`
      UPDATE yt_throttle
         SET tokens = ?, ratchet = ?, updated_at = ?, paused_until = ?, limited_at = ?
       WHERE id = 1
    `)
  }

  get(now: number): ThrottleState {
    const row = this.#read.get()
    if (!row) return freshState(now)
    return {
      tokens: row.tokens,
      ratchet: row.ratchet,
      updatedAt: row.updated_at,
      pausedUntil: row.paused_until,
      limitedAt: row.limited_at,
    }
  }

  save(state: ThrottleState): void {
    this.#write.run(
      state.tokens,
      state.ratchet,
      state.updatedAt,
      state.pausedUntil,
      state.limitedAt,
    )
  }
}

interface Row {
  tokens: number
  ratchet: number
  updated_at: number
  paused_until: number
  limited_at: number
}
