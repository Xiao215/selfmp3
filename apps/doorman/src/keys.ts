import { fromBase64, utf8 } from './encoding.js'

/**
 * Every key the doorman uses, derived from the one secret it is given.
 *
 * SEAL_KEY is 32 random bytes. It is never used as a key itself: HKDF turns
 * it into one key per job, each under its own label, so no two jobs ever
 * share a key — a value made for one (a sealed bucket, a sign-in's state)
 * can never be passed off as another. They all change together when
 * SEAL_KEY does, which ends every sign-in in progress and makes every
 * sealed bucket unreadable (each account then connects its bucket again).
 */

export interface DoormanKeys {
  /** AES-256-GCM, for a bucket's details in KV. See seal.ts. */
  readonly seal: CryptoKey
  /** HMAC-SHA-256, for the state that goes to Google and comes back. */
  readonly state: CryptoKey
  /** HMAC-SHA-256, for the PKCE verifier, worked out again from the state. */
  readonly pkce: CryptoKey
  /** HMAC-SHA-256, for the code shown at the end of a sign-in. */
  readonly code: CryptoKey
}

export class KeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyError'
  }
}

const SALT = utf8('self.mp3 doorman')

/** SEAL_KEY's keys. The error says what is wrong with it, never what it is. */
export async function deriveKeys(secret: string | undefined): Promise<DoormanKeys> {
  const bytes = secret ? fromBase64(secret.trim()) : null
  if (!bytes || bytes.length !== 32) {
    throw new KeyError(
      'SEAL_KEY must be 32 random bytes in base64, as `openssl rand -base64 32` prints them.',
    )
  }
  const master = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
  const hkdf = (label: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: utf8(label) })
  const hmac = { name: 'HMAC', hash: 'SHA-256', length: 256 }

  const [seal, state, pkce, code] = await Promise.all([
    crypto.subtle.deriveKey(
      hkdf('seal a bucket v1'),
      master,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
    crypto.subtle.deriveKey(hkdf('sign-in state v1'), master, hmac, false, ['sign', 'verify']),
    crypto.subtle.deriveKey(hkdf('pkce verifier v1'), master, hmac, false, ['sign', 'verify']),
    crypto.subtle.deriveKey(hkdf('sign-in code v1'), master, hmac, false, ['sign', 'verify']),
  ])
  return { seal, state, pkce, code }
}
