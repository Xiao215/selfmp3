import crypto from 'node:crypto'
import type { Db } from '../db/index.js'

/**
 * The key to this server's own API.
 *
 * The API is the whole library — reading it, editing it, deleting from it — and
 * it listens on every interface, because the addresses it listens on are what a
 * device signed in to the bucket finds it by. So there has to be a key, and it
 * cannot be one somebody has to set: an optional lock is an unlocked door.
 *
 * It is made on the first boot that finds none and kept from then on, so the
 * token a device was given last week still works today. `SELFMP3_AUTH_TOKEN`
 * overrides it and is never written here — a token set by hand belongs to
 * whoever set it, and rewriting the database from an environment variable would
 * make the two disagree the moment the variable was unset.
 *
 * It lives in `secrets`, the table the cloud connection and this server's cloud
 * device id already use: a table that exists so its rows can never come back
 * out of `GET /api/settings` by accident, which is exactly the property wanted
 * here. That also puts it inside the data directory, so `selfmp3 backup` and a
 * `SELFMP3_PROFILE` installation both treat it the way they treat everything
 * else the server knows — carried along by the first, separate under the
 * second. A file beside the database would be a second kind of state for no
 * gain, and one more thing to remember to copy.
 */

const TOKEN_SECRET = 'server.token'

/** 32 bytes, base64url: no padding, nothing to escape in a query string. */
function newToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export class AuthRepository {
  readonly #db: Db
  readonly #get
  readonly #insert

  constructor(db: Db) {
    this.#db = db
    this.#get = db.prepare<[string], { value: string }>('SELECT value FROM secrets WHERE name = ?')
    // `DO NOTHING`, not an upsert: two processes racing on the same database
    // must end up agreeing on one token rather than each keeping its own.
    this.#insert = db.prepare(
      'INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT (name) DO NOTHING',
    )
  }

  /** The token this server answers to, made and stored the first time it is asked for. */
  token(): string {
    return this.#db.transaction(() => {
      const existing = this.#get.get(TOKEN_SECRET)?.value
      if (existing) return existing
      const made = newToken()
      this.#insert.run(TOKEN_SECRET, made)
      return this.#get.get(TOKEN_SECRET)?.value ?? made
    })()
  }
}
