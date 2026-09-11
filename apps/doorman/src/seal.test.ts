import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from './encoding.js'
import { SEAL_KEY } from './fakes.js'
import { SealError, importSealKey, seal, unseal } from './seal.js'

/**
 * Sealing is what keeps a bucket's key unreadable in KV. The properties that
 * matter: it opens again for the same account with the same key, and it does
 * not open at all — rather than opening as something else — if anything about
 * it changed.
 */

const SECRET = JSON.stringify({ keyId: '004abc', applicationKey: 'K004-very-secret' })

describe('seal', () => {
  it('round-trips, and never shows what it sealed', async () => {
    const key = await importSealKey(SEAL_KEY)
    const sealed = await seal(SECRET, key, 'account:1')
    expect(sealed).toMatch(/^v1:[A-Za-z0-9+/]+=*$/)
    expect(sealed).not.toContain('K004-very-secret')
    expect(await unseal(sealed, key, 'account:1')).toBe(SECRET)
  })

  it('uses a fresh IV every time, so the same key never seals to the same text twice', async () => {
    const key = await importSealKey(SEAL_KEY)
    expect(await seal(SECRET, key, 'account:1')).not.toBe(await seal(SECRET, key, 'account:1'))
  })

  it('refuses a sealed value that was changed by even one bit', async () => {
    const key = await importSealKey(SEAL_KEY)
    const sealed = await seal(SECRET, key, 'account:1')
    const bytes = fromBase64(sealed.slice(3)) ?? new Uint8Array()
    for (const index of [0, 12, bytes.length - 1]) {
      const tampered = bytes.slice()
      tampered[index] = (tampered[index] ?? 0) ^ 1
      await expect(unseal(`v1:${toBase64(tampered)}`, key, 'account:1')).rejects.toThrow(SealError)
    }
  })

  it('opens only for the account it was sealed for', async () => {
    const key = await importSealKey(SEAL_KEY)
    const sealed = await seal(SECRET, key, 'account:1')
    await expect(unseal(sealed, key, 'account:2')).rejects.toThrow(SealError)
  })

  it('opens only with the key it was sealed with', async () => {
    const sealed = await seal(SECRET, await importSealKey(SEAL_KEY), 'account:1')
    const other = await importSealKey(toBase64(new Uint8Array(32).fill(9)))
    await expect(unseal(sealed, other, 'account:1')).rejects.toThrow(SealError)
  })

  it('refuses what is not a sealed value at all', async () => {
    const key = await importSealKey(SEAL_KEY)
    for (const value of ['', 'v1:', 'v1:!!!', 'v2:AAAA', SECRET]) {
      await expect(unseal(value, key, 'account:1')).rejects.toThrow(SealError)
    }
  })

  it('wants SEAL_KEY to be 32 bytes of base64, and says so without repeating it', async () => {
    for (const secret of [undefined, '', 'not base64 at all', toBase64(new Uint8Array(16))]) {
      const error = await importSealKey(secret).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SealError)
      expect((error as Error).message).toMatch(/32 random bytes/)
      if (secret) expect((error as Error).message).not.toContain(secret)
    }
  })
})
