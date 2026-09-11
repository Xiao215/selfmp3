import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64, utf8 } from './encoding.js'
import { SEAL_KEY } from './fakes.js'
import { KeyError, deriveKeys } from './keys.js'
import { SealError, seal, unseal } from './seal.js'

/**
 * Sealing is what keeps a bucket's key unreadable in KV. The properties that
 * matter: it opens again for the same account with the same key, and it does
 * not open at all — rather than opening as something else — if anything about
 * it changed. And SEAL_KEY is never a key itself, only the root of one per job.
 */

const SECRET = JSON.stringify({ keyId: '004abc', applicationKey: 'K004-very-secret' })

describe('seal', () => {
  it('round-trips, and never shows what it sealed', async () => {
    const { seal: key } = await deriveKeys(SEAL_KEY)
    const sealed = await seal(SECRET, key, 'bucket:1')
    expect(sealed).toMatch(/^v1:[A-Za-z0-9+/]+=*$/)
    expect(sealed).not.toContain('K004-very-secret')
    expect(await unseal(sealed, key, 'bucket:1')).toBe(SECRET)
  })

  it('uses a fresh IV every time, so the same key never seals to the same text twice', async () => {
    const { seal: key } = await deriveKeys(SEAL_KEY)
    expect(await seal(SECRET, key, 'bucket:1')).not.toBe(await seal(SECRET, key, 'bucket:1'))
  })

  it('refuses a sealed value that was changed by even one bit', async () => {
    const { seal: key } = await deriveKeys(SEAL_KEY)
    const sealed = await seal(SECRET, key, 'bucket:1')
    const bytes = fromBase64(sealed.slice(3)) ?? new Uint8Array()
    for (const index of [0, 12, bytes.length - 1]) {
      const tampered = bytes.slice()
      tampered[index] = (tampered[index] ?? 0) ^ 1
      await expect(unseal(`v1:${toBase64(tampered)}`, key, 'bucket:1')).rejects.toThrow(SealError)
    }
  })

  it('opens only for the account it was sealed for', async () => {
    const { seal: key } = await deriveKeys(SEAL_KEY)
    const sealed = await seal(SECRET, key, 'bucket:1')
    await expect(unseal(sealed, key, 'bucket:2')).rejects.toThrow(SealError)
  })

  it('opens only with the key it was sealed with', async () => {
    const sealed = await seal(SECRET, (await deriveKeys(SEAL_KEY)).seal, 'bucket:1')
    const other = await deriveKeys(toBase64(new Uint8Array(32).fill(9)))
    await expect(unseal(sealed, other.seal, 'bucket:1')).rejects.toThrow(SealError)
  })

  it('refuses what is not a sealed value at all', async () => {
    const { seal: key } = await deriveKeys(SEAL_KEY)
    for (const value of ['', 'v1:', 'v1:!!!', 'v2:AAAA', SECRET]) {
      await expect(unseal(value, key, 'bucket:1')).rejects.toThrow(SealError)
    }
  })
})

describe('the keys', () => {
  it('want SEAL_KEY to be 32 bytes of base64, and say so without repeating it', async () => {
    for (const secret of [undefined, '', 'not base64 at all', toBase64(new Uint8Array(16))]) {
      const error = await deriveKeys(secret).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(KeyError)
      expect((error as Error).message).toMatch(/32 random bytes/)
      if (secret) expect((error as Error).message).not.toContain(secret)
    }
  })

  it('are one per job, so a value made for one is no good for another', async () => {
    const keys = await deriveKeys(SEAL_KEY)
    const message = utf8('the same words')
    const macs = await Promise.all(
      [keys.state, keys.pkce, keys.code].map(async key =>
        toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, message))),
      ),
    )
    expect(new Set(macs).size).toBe(3)
  })

  it('are the same every time for the same SEAL_KEY, and different for another', async () => {
    const mac = async (secret: string) => {
      const { code } = await deriveKeys(secret)
      return toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', code, utf8('x'))))
    }
    expect(await mac(SEAL_KEY)).toBe(await mac(SEAL_KEY))
    expect(await mac(SEAL_KEY)).not.toBe(await mac(toBase64(new Uint8Array(32).fill(9))))
  })
})
