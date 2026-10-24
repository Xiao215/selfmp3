import type { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
  type UpdateSettings,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * Settings live in a key/value table rather than a single JSON blob, so two
 * clients writing different settings at the same time cannot clobber each
 * other's change. Reads merge stored values over the defaults, which means a
 * newly added setting works immediately without a migration. Each stored value
 * is checked against its own field: one that no longer fits falls back to its
 * default alone, and every other setting keeps what was chosen.
 */
export class SettingsRepository {
  readonly #all
  readonly #upsert
  readonly #writeAll

  constructor(db: Db) {
    this.#all = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
    this.#upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `)
    // One patch is one change as far as anything reading is concerned: a
    // failure half way through would otherwise leave the settings in a state
    // nobody asked for.
    this.#writeAll = db.transaction((entries: readonly (readonly [string, unknown])[]) => {
      for (const [key, value] of entries) this.#upsert.run(key, JSON.stringify(value))
    })
  }

  get(): Settings {
    const fields: Record<string, z.ZodTypeAny | undefined> = SettingsSchema.shape
    const stored: Record<string, unknown> = {}
    for (const row of this.#all.all()) {
      const field = fields[row.key]
      if (!field) continue
      let value: unknown
      try {
        value = JSON.parse(row.value)
      } catch {
        continue
      }
      const parsed = field.safeParse(value)
      if (parsed.success) stored[row.key] = parsed.data
    }
    return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...stored })
  }

  update(patch: UpdateSettings): Settings {
    this.#writeAll(Object.entries(patch).filter(([, value]) => value !== undefined))
    return this.get()
  }
}
