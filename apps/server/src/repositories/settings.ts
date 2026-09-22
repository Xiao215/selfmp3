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
 * newly added setting works immediately without a migration. It also works the
 * other way: the schema strips keys it does not know, so the row of a setting
 * that was later removed is simply ignored.
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
    const stored: Record<string, unknown> = {}
    for (const row of this.#all.all()) {
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        // A corrupt value falls back to its default rather than breaking boot.
      }
    }

    const merged = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored })
    return merged.success ? merged.data : DEFAULT_SETTINGS
  }

  update(patch: UpdateSettings): Settings {
    this.#writeAll(Object.entries(patch).filter(([, value]) => value !== undefined))
    return this.get()
  }
}
