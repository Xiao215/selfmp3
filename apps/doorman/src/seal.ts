import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from './encoding.js'

/**
 * Sealing a bucket's details before they go into KV.
 *
 * AES-256-GCM, under a key only the Worker has (derived from SEAL_KEY, see
 * keys.ts). Anyone who can read the KV namespace — in the Cloudflare
 * dashboard, say — sees `v1:` and noise, and GCM's tag means a sealed value
 * that has been changed does not open at all, rather than opening as
 * something else.
 *
 * Each value is sealed for a context (the account it belongs to), passed as
 * GCM's additional data. It is not secret, but it ties the value to that
 * account: one copied onto another account's record will not open there.
 *
 * `v1:` names the scheme, so a later one can be told apart from this one.
 */

const SCHEME = 'v1:'
const IV_BYTES = 12
const TAG_BYTES = 16

export class SealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealError'
  }
}

export async function seal(plaintext: string, key: CryptoKey, context: string): Promise<string> {
  const iv = randomBytes(IV_BYTES)
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(context) },
      key,
      utf8(plaintext),
    ),
  )
  const out = new Uint8Array(IV_BYTES + sealed.length)
  out.set(iv)
  out.set(sealed, IV_BYTES)
  return SCHEME + toBase64(out)
}

export async function unseal(value: string, key: CryptoKey, context: string): Promise<string> {
  const bytes = value.startsWith(SCHEME) ? fromBase64(value.slice(SCHEME.length)) : null
  if (!bytes || bytes.length < IV_BYTES + TAG_BYTES) throw new SealError('not a sealed value')
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: utf8(context) },
      key,
      bytes.subarray(IV_BYTES),
    )
    return fromUtf8(new Uint8Array(plain))
  } catch {
    throw new SealError('the value was changed, or sealed with another key or for someone else')
  }
}
