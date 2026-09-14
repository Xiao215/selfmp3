import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, safeStorage } from 'electron'

/**
 * The keychain, as the page sees it.
 *
 * Each value is sealed with `safeStorage` — on macOS that is a key in the login
 * keychain — and the sealed bytes are kept base64 in one JSON document under
 * `userData`. One document rather than one file per key because there are two
 * or three of these, and a document can be written atomically.
 *
 * The browser's answer to the same port is `localStorage`, which is protected
 * by the origin and nothing else. This is the difference an installed app is
 * for, and the plan's rule is absolute: tokens go through here and nowhere
 * else, never into the renderer's own storage.
 */

/**
 * The document's shape, kept pure so it can be tested without a keychain.
 *
 * Each value carries how it was stored: `k:` is sealed by `safeStorage`, `p:`
 * is base64 and nothing more. The tag is there because the two cannot be told
 * apart by looking, and opening a plain value as a sealed one throws.
 */
export type SealedSecrets = Record<string, string>

export const SEALED = 'k:'
export const PLAIN = 'p:'

export function parseSecrets(text: string): SealedSecrets {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A half-written file is not worth losing the app over; it is a forgotten
    // token, and signing in again is the recovery.
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: SealedSecrets = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export function serialiseSecrets(secrets: SealedSecrets): string {
  // Sorted, so the file does not churn on every write for no reason.
  const sorted = Object.fromEntries(Object.entries(secrets).sort(([a], [b]) => a.localeCompare(b)))
  return `${JSON.stringify(sorted, null, 2)}\n`
}

function file(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

/**
 * The document as last read or written. This process is the only writer, so
 * after the first read the file has nothing to add — and every `get` used to
 * be a synchronous read and parse on the main process, which is the one that
 * also draws the window.
 */
let cached: SealedSecrets | null = null

/**
 * What each sealed value opened to. Opening is a keychain call; a token is
 * asked for on every request the page signs, and it has not changed since the
 * last time. Keyed by the sealed text itself, so a value written again is
 * opened again.
 */
const opened = new Map<string, string | null>()

/** A copy: callers change what they are given, and the cache must not change with it. */
function read(): SealedSecrets {
  if (cached === null) {
    try {
      cached = parseSecrets(readFileSync(file(), 'utf8'))
    } catch {
      cached = {}
    }
  }
  return { ...cached }
}

/**
 * Write through a temporary file and rename.
 *
 * A rename is atomic on the same filesystem, so a crash halfway leaves either
 * the old document or the new one — never a truncated one, which would read
 * back as "signed out" and is the worst way to lose a session.
 */
function write(secrets: SealedSecrets): void {
  const target = file()
  const temporary = `${target}.tmp`
  writeFileSync(temporary, serialiseSecrets(secrets), { mode: 0o600 })
  renameSync(temporary, target)
  // Only once the file says so: a write that threw leaves the cache on what is on disk.
  cached = { ...secrets }
  opened.clear()
}

/**
 * Whether this machine has a real store behind `safeStorage`.
 *
 * macOS: the login keychain, always. Linux: only where a secret service
 * answers. The plan's risk table already settled what to do when it does not —
 * "plain JSON with a warning in Settings — the browser's promise, no worse" —
 * because the alternative is an installed app that cannot sign in at all, which
 * is worse than the tab it replaced.
 */
export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export const secretStore = {
  get(key: string): string | null {
    const stored = read()[key]
    if (stored === undefined) return null
    if (stored.startsWith(PLAIN)) {
      return Buffer.from(stored.slice(PLAIN.length), 'base64').toString('utf8')
    }
    if (!stored.startsWith(SEALED)) return null
    const known = opened.get(stored)
    if (known !== undefined) return known
    let value: string | null
    try {
      value = safeStorage.decryptString(Buffer.from(stored.slice(SEALED.length), 'base64'))
    } catch {
      // Sealed by a keychain this login no longer has, which is a sign-in
      // again rather than an error to show.
      value = null
    }
    opened.set(stored, value)
    return value
  },

  set(key: string, value: string): void {
    const stored = encryptionAvailable()
      ? SEALED + safeStorage.encryptString(value).toString('base64')
      : PLAIN + Buffer.from(value, 'utf8').toString('base64')
    write({ ...read(), [key]: stored })
  },

  remove(key: string): void {
    const secrets = read()
    if (!(key in secrets)) return
    delete secrets[key]
    write(secrets)
  },
}
