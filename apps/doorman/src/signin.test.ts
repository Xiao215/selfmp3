import {
  SIGN_IN_CODE_ALPHABET,
  SignInCodeSchema,
  formatSignInCode,
  normalizeSignInCode,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { toBase64, toBase64Url, utf8 } from './encoding.js'
import { SEAL_KEY, newAttempt } from './fakes.js'
import { deriveKeys } from './keys.js'
import {
  codeMatches,
  codeTag,
  newSignInCode,
  openState,
  pkceChallenge,
  pkceVerifier,
  signState,
  type SignInState,
} from './signin.js'

/**
 * The parts of a sign-in the doorman keeps nowhere: a state that only this
 * doorman can have made, a PKCE verifier worked out again from it, and a
 * code that is kept only as a MAC.
 */

const NOW = Date.parse('2026-09-11T12:00:00Z')

function state(changes: Partial<SignInState> = {}): SignInState {
  return {
    attempt: newAttempt(),
    returnTo: 'https://xiao215.github.io/selfmp3/',
    nonce: 'n'.repeat(43),
    exp: NOW + 600_000,
    ...changes,
  }
}

describe('the state', () => {
  it('comes back as it went, while it is good', async () => {
    const { state: key } = await deriveKeys(SEAL_KEY)
    const original = state()
    const signed = await signState(original, key)
    expect(signed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(await openState(signed, key, NOW)).toEqual(original)
    expect(await openState(signed, key, original.exp)).toBeNull()
  })

  it('is refused when anything about it changed', async () => {
    const { state: key } = await deriveKeys(SEAL_KEY)
    const signed = await signState(state(), key)
    const [payload = '', mac = ''] = signed.split('.')
    const other = toBase64Url(utf8(JSON.stringify(state({ returnTo: 'https://evil.example/' }))))
    for (const value of [
      `${other}.${mac}`,
      `${payload}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`,
      `${payload}.`,
      `.${mac}`,
      payload,
      `${payload}.${mac}.${mac}`,
      '',
      `${'x'.repeat(5000)}.${mac}`,
    ]) {
      expect(await openState(value, key, NOW)).toBeNull()
    }
  })

  it('is refused by a doorman with another SEAL_KEY', async () => {
    const signed = await signState(state(), (await deriveKeys(SEAL_KEY)).state)
    const other = await deriveKeys(toBase64(new Uint8Array(32).fill(3)))
    expect(await openState(signed, other.state, NOW)).toBeNull()
  })

  it('is refused when what was signed is not a state', async () => {
    const { state: key } = await deriveKeys(SEAL_KEY)
    const mac = async (payload: string) =>
      toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(payload))))
    for (const json of ['not json', '{}', JSON.stringify({ ...state(), attempt: 'x' })]) {
      const payload = toBase64Url(utf8(json))
      expect(await openState(`${payload}.${await mac(payload)}`, key, NOW)).toBeNull()
    }
  })
})

describe('PKCE', () => {
  it('works the verifier out again from the nonce, and nobody without the key can', async () => {
    const keys = await deriveKeys(SEAL_KEY)
    const other = await deriveKeys(toBase64(new Uint8Array(32).fill(3)))
    const verifier = await pkceVerifier('n'.repeat(43), keys.pkce)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await pkceVerifier('n'.repeat(43), keys.pkce)).toBe(verifier)
    expect(await pkceVerifier('m'.repeat(43), keys.pkce)).not.toBe(verifier)
    expect(await pkceVerifier('n'.repeat(43), other.pkce)).not.toBe(verifier)
  })

  it('gives Google the S256 challenge: base64url of the verifier’s SHA-256', async () => {
    const digest = await crypto.subtle.digest('SHA-256', utf8('a-verifier'))
    expect(await pkceChallenge('a-verifier')).toBe(toBase64Url(new Uint8Array(digest)))
  })
})

describe('the sign-in code', () => {
  it('is eight characters of Crockford’s base 32, each as likely as any other', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i++) {
      const code = newSignInCode()
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
      expect(SignInCodeSchema.parse(code)).toBe(code)
      for (const char of code) counts.set(char, (counts.get(char) ?? 0) + 1)
    }
    // 32,000 characters: about a thousand of each, well within these bounds.
    expect([...counts.keys()].sort().join('')).toBe(SIGN_IN_CODE_ALPHABET)
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(800)
      expect(count).toBeLessThan(1200)
    }
  })

  it('is kept as a MAC that matches it, for its attempt, and nothing else', async () => {
    const { code: key } = await deriveKeys(SEAL_KEY)
    const other = await deriveKeys(toBase64(new Uint8Array(32).fill(3)))
    const attempt = newAttempt()
    const tag = await codeTag(attempt, '4F7K2QXM', key)
    expect(tag).not.toContain('4F7K2QXM')
    expect(await codeMatches(attempt, '4F7K2QXM', tag, key)).toBe(true)
    expect(await codeMatches(attempt, '4F7K2QXN', tag, key)).toBe(false)
    expect(await codeMatches(newAttempt(), '4F7K2QXM', tag, key)).toBe(false)
    expect(await codeMatches(attempt, '4F7K2QXM', tag, other.code)).toBe(false)
    expect(await codeMatches(attempt, '4F7K2QXM', 'not-a-tag', key)).toBe(false)
    expect(await codeMatches(attempt, '4F7K2QXM', '', key)).toBe(false)
  })

  it('is read back the way people type it, and shown in two halves', () => {
    expect(normalizeSignInCode(' 4f7k-2qxm ')).toBe('4F7K2QXM')
    expect(normalizeSignInCode('I l O o')).toBe('1100')
    expect(formatSignInCode('4f7k2qxm')).toBe('4F7K-2QXM')
    expect(SignInCodeSchema.safeParse('4F7K-2QXU').success).toBe(false)
  })
})
