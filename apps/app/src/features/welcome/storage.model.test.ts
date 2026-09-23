import { describe, expect, it } from 'vitest'

import { afterWelcome, FIRST_SYNC_SEEN } from './firstSync.model'
import {
  addressReady,
  backblazeReady,
  needsRegion,
  STORAGE_ROUTE,
  storageDue,
  whereItIs,
} from './storage.model'

/**
 * Where it lives' rules: that it is due exactly when the account has no
 * bucket, that it comes before First sync, and what each way of filling it
 * in needs before Connect means anything.
 */
describe('whether Where it lives is due', () => {
  it('is due for an account with no bucket', () => {
    expect(storageDue({ me: { storage: null } })).toBe(true)
  })

  it('is not due once the account has one, nor when nobody is signed in', () => {
    expect(storageDue({ me: { storage: { bucket: 'my-music' } } })).toBe(false)
    expect(storageDue(null)).toBe(false)
  })

  it('comes before First sync, and before Home', () => {
    expect(afterWelcome(true, null, true, true)).toBe(STORAGE_ROUTE)
    expect(afterWelcome(true, FIRST_SYNC_SEEN, false, true)).toBe(STORAGE_ROUTE)
    // Once the bucket is there, the usual way on.
    expect(afterWelcome(true, null, true, false)).toBe('/first-sync')
    // A server typed in development has no bucket to ask for.
    expect(afterWelcome(false, null, true, true)).toBe('/')
  })
})

describe('the Backblaze way', () => {
  it('needs both strings', () => {
    expect(backblazeReady('004abc', 'K004')).toBe(true)
    expect(backblazeReady('004abc', ' ')).toBe(false)
    expect(backblazeReady('', 'K004')).toBe(false)
  })
})

describe('the address way', () => {
  const filled = {
    endpoint: 's3.us-west-004.backblazeb2.com',
    region: '',
    bucket: 'my-music',
    prefix: 'selfmp3',
    keyId: '004abc',
    applicationKey: 'K004',
  }

  it('is ready with an address that names its region', () => {
    expect(addressReady(filled)).toBe(true)
    expect(needsRegion(filled.endpoint)).toBe(false)
  })

  it('asks for a region when the address does not say', () => {
    const r2 = { ...filled, endpoint: 'abc123.r2.cloudflarestorage.com' }
    expect(needsRegion(r2.endpoint)).toBe(true)
    expect(addressReady(r2)).toBe(false)
    expect(addressReady({ ...r2, region: 'auto' })).toBe(true)
  })

  it('is not ready with a field missing or an address that is not one', () => {
    expect(addressReady({ ...filled, bucket: '' })).toBe(false)
    expect(addressReady({ ...filled, endpoint: 'not an address' })).toBe(false)
  })
})

describe('where the bucket is, in words', () => {
  const storage = {
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'selfmp3-xiao',
    prefix: 'selfmp3',
    keyIdHint: '004abc…',
  }

  it('names Backblaze and the region', () => {
    expect(whereItIs(storage)).toBe('selfmp3-xiao on Backblaze, us-west-004')
  })

  it('names any other provider by its address', () => {
    expect(
      whereItIs({
        ...storage,
        endpoint: 'https://abc123.r2.cloudflarestorage.com',
        region: 'auto',
      }),
    ).toBe('selfmp3-xiao at abc123.r2.cloudflarestorage.com')
  })
})
