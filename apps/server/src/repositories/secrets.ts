import type { SecretProvider, SecretsStatus } from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * API keys for optional providers.
 *
 * Kept in their own table, and this repository never returns a key to a route
 * that could forward it to the client — only "is one set". The key itself is
 * read solely by the service that talks to the provider.
 */
export class SecretsRepository {
  readonly #get
  readonly #upsert
  readonly #delete

  constructor(db: Db) {
    this.#get = db.prepare<[string], { value: string }>('SELECT value FROM secrets WHERE name = ?')
    this.#upsert = db.prepare(`
      INSERT INTO secrets (name, value) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value
    `)
    this.#delete = db.prepare('DELETE FROM secrets WHERE name = ?')
  }

  /** The raw key, for the provider client only. */
  apiKey(provider: SecretProvider): string | null {
    return this.#get.get(`apiKey:${provider}`)?.value ?? null
  }

  setApiKey(provider: SecretProvider, key: string | null): void {
    if (key === null || key.trim() === '') this.#delete.run(`apiKey:${provider}`)
    else this.#upsert.run(`apiKey:${provider}`, key.trim())
  }

  /** What the client is allowed to know. */
  status(): SecretsStatus {
    return {
      anthropic: { hasKey: this.apiKey('anthropic') !== null },
      openai: { hasKey: this.apiKey('openai') !== null },
    }
  }
}
