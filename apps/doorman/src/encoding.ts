/**
 * Bytes to text and back, using only what the Workers runtime and Node both
 * have: TextEncoder, atob and btoa, and WebCrypto. No Buffer, so the Worker's
 * code is exactly the code the tests run.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function utf8(text: string): Uint8Array {
  return encoder.encode(text)
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Null for anything that is not base64. */
export function fromBase64(text: string): Uint8Array | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Base64 that can go in a URL or a KV key as it is: no `+`, `/` or padding. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Null for anything `toBase64Url` would not have written. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = fromBase64(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  /*
   * Six bits a character rarely divide evenly into bytes, so the last
   * character of a value usually carries a few bits of nothing after the last
   * byte of it. `atob` throws those bits away without looking at them, which
   * leaves every value several spellings: the forty-three characters of a
   * thirty-two byte MAC end in two spare bits, so `…A`, `…B`, `…C` and `…D`
   * all decode alike and a MAC changed in its last character still verifies.
   * Only the one spelling an encoder writes is one of ours.
   */
  return bytes && toBase64Url(bytes) === text ? bytes : null
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  let out = ''
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, '0')
  return out
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** A fresh random token: 32 bytes, base64url, 43 characters. */
export function randomToken(): string {
  return toBase64Url(randomBytes(32))
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', utf8(text)))
}

export async function sha256Base64(text: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text))))
}
