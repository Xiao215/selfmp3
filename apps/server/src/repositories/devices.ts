import {
  isDeviceOnline,
  PlaybackStateSchema,
  type Device,
  type DeviceHeartbeat,
  type DeviceKind,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * All SQL that touches `devices` lives here.
 *
 * A device's state column is the heartbeat's JSON as-is; it is parsed back
 * through the schema on read so a row written by an older build can never
 * hand a malformed state to a client.
 */

interface DeviceRow {
  id: string
  name: string
  kind: string
  state: string
  last_seen_at: number
}

export class DeviceRepository {
  readonly #all
  readonly #byId
  readonly #upsert
  readonly #delete
  readonly #prune

  constructor(db: Db) {
    this.#all = db.prepare<[], DeviceRow>('SELECT * FROM devices ORDER BY last_seen_at DESC')
    this.#byId = db.prepare<[string], DeviceRow>('SELECT * FROM devices WHERE id = ?')
    this.#upsert = db.prepare(`
      INSERT INTO devices (id, name, kind, state, last_seen_at)
      VALUES (@id, @name, @kind, @state, @lastSeenAt)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        state = excluded.state,
        last_seen_at = excluded.last_seen_at
    `)
    this.#delete = db.prepare('DELETE FROM devices WHERE id = ?')
    this.#prune = db.prepare('DELETE FROM devices WHERE last_seen_at < ?')
  }

  upsert(heartbeat: DeviceHeartbeat, now: number): void {
    this.#upsert.run({
      id: heartbeat.deviceId,
      name: heartbeat.name,
      kind: heartbeat.kind,
      state: JSON.stringify(heartbeat.state),
      lastSeenAt: now,
    })
  }

  remove(id: string): boolean {
    return this.#delete.run(id).changes > 0
  }

  /** Forget devices not seen since `before` (ms epoch). */
  prune(before: number): number {
    return this.#prune.run(before).changes
  }

  byId(id: string, now: number): Device | null {
    const row = this.#byId.get(id)
    return row ? toDevice(row, now) : null
  }

  all(now: number): Device[] {
    const out: Device[] = []
    for (const row of this.#all.all()) {
      const device = toDevice(row, now)
      if (device) out.push(device)
    }
    return out
  }
}

function toDevice(row: DeviceRow, now: number): Device | null {
  let raw: unknown
  try {
    raw = JSON.parse(row.state)
  } catch {
    return null
  }
  const state = PlaybackStateSchema.safeParse(raw)
  if (!state.success) return null

  const kind: DeviceKind =
    row.kind === 'phone' || row.kind === 'desktop' || row.kind === 'other' ? row.kind : 'other'

  return {
    id: row.id,
    name: row.name,
    kind,
    state: state.data,
    lastSeenAt: row.last_seen_at,
    online: isDeviceOnline(row.last_seen_at, now),
  }
}
