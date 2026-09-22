import { SIGN_IN_CODE_ALPHABET, SignInAttemptSchema } from '@selfmp3/shared'
import { z } from 'zod'
import { fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from './encoding.js'

/**
 * The parts of a sign-in the doorman keeps nowhere.
 *
 * Starting a sign-in writes nothing to KV: anyone can open the start link,
 * and the free plan's thousand writes a day must not be theirs to spend. So
 * what the callback needs to know — which attempt, where to go back to, the
 * nonce, and until when — travels to Google and back as the `state`, signed
 * with a key only the doorman has. The PKCE verifier is worked out again from
 * the state's nonce, so it needs keeping nowhere either. The first write is
 * made only once Google has vouched for an address on the list.
 *
 * The code shown at the end of a sign-in is kept only as a MAC, tied to its
 * attempt, and compared in constant time by WebCrypto's own verify.
 */

/** How long a sign-in may take between starting and Google coming back. */
export const SIGN_IN_TTL_MS = 10 * 60_000

const MINUTES_IN_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/**
 * "ten minutes", for the page that shows someone their code.
 *
 * Written out rather than typed out: the page is telling a person how long
 * they have, and the only thing that decides that is `SIGN_IN_TTL_MS`. Past
 * ten the digits read better than the word anyway.
 */
export function signInTtlInWords(): string {
  const minutes = Math.round(SIGN_IN_TTL_MS / 60_000)
  return `${MINUTES_IN_WORDS[minutes] ?? String(minutes)} minute${minutes === 1 ? '' : 's'}`
}

/** A state is a few hundred characters; anything far longer is not one of ours. */
const MAX_STATE_LENGTH = 4096

const StateSchema = z.object({
  attempt: SignInAttemptSchema,
  /** Where the browser goes afterwards, already checked; or nowhere. */
  returnTo: z.string().nullable(),
  /** Put in the ID token by Google, and the root of the PKCE verifier. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** When the sign-in stops being good, in milliseconds. */
  exp: z.number().int(),
})
export type SignInState = z.infer<typeof StateSchema>

/** `<payload>.<mac>`, both base64url: safe in a URL as it is. */
export async function signState(state: SignInState, key: CryptoKey): Promise<string> {
  const payload = toBase64Url(utf8(JSON.stringify(state)))
  return `${payload}.${await mac(key, payload)}`
}

/** The state Google sent back, if this doorman made it and it is still good. */
export async function openState(
  value: string,
  key: CryptoKey,
  now: number,
): Promise<SignInState | null> {
  if (value.length > MAX_STATE_LENGTH) return null
  const dot = value.lastIndexOf('.')
  const payload = value.slice(0, Math.max(dot, 0))
  const tag = fromBase64Url(value.slice(dot + 1))
  if (dot <= 0 || !tag || tag.length !== 32) return null
  if (!(await crypto.subtle.verify('HMAC', key, tag, utf8(payload)))) return null

  const bytes = fromBase64Url(payload)
  if (!bytes) return null
  let data: unknown
  try {
    data = JSON.parse(fromUtf8(bytes))
  } catch {
    return null
  }
  const parsed = StateSchema.safeParse(data)
  return parsed.success && parsed.data.exp > now ? parsed.data : null
}

/** The PKCE verifier for a sign-in, from its nonce: 43 characters of base64url. */
export function pkceVerifier(nonce: string, key: CryptoKey): Promise<string> {
  return mac(key, `pkce\n${nonce}`)
}

/** What Google is told at the start, so it can check the verifier at the end (S256). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))))
}

/**
 * A fresh code: eight characters of Crockford's base 32, forty bits. Each
 * comes from one random byte, and 256 is a multiple of 32, so no character is
 * likelier than another.
 */
export function newSignInCode(): string {
  let code = ''
  for (const byte of randomBytes(8)) code += SIGN_IN_CODE_ALPHABET.charAt(byte & 31)
  return code
}

/** What is kept instead of the code: its MAC, tied to the attempt it is for. */
export function codeTag(attempt: string, code: string, key: CryptoKey): Promise<string> {
  return mac(key, `${attempt}\n${code}`)
}

/** Whether a code is the one shown for this attempt, compared in constant time. */
export async function codeMatches(
  attempt: string,
  code: string,
  tag: string,
  key: CryptoKey,
): Promise<boolean> {
  const bytes = fromBase64Url(tag)
  if (!bytes || bytes.length !== 32) return false
  return crypto.subtle.verify('HMAC', key, bytes, utf8(`${attempt}\n${code}`))
}

async function mac(key: CryptoKey, message: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message))))
}
