import { describe, expect, it } from 'vitest'

import { afterWelcome, FIRST_SYNC_SEEN } from './firstSync.model'
import {
  STORAGE_ROUTE,
  addressReady,
  backblazeReady,
  cloudConnectInput,
  driveArrived,
  moveAction,
  movedLine,
  moveProgressLine,
  needsRegion,
  spaceLine,
  spaceLow,
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
    kind: 'bucket' as const,
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'selfmp3-xiao',
    prefix: 'selfmp3',
    keyIdHint: '004abc…',
  }

  it('names Backblaze and the region', () => {
    expect(whereItIs(storage)).toBe('selfmp3-xiao on Backblaze, us-west-004')
  })

  it('names Google Drive by the folder the library is in', () => {
    expect(whereItIs({ kind: 'drive', folder: '1AbC' })).toBe('self.mp3 in your Google Drive')
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

describe('Google Drive arriving with no link to say so', () => {
  const drive = { kind: 'drive' as const, folder: '1AbC' }
  const bucket = {
    kind: 'bucket' as const,
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'selfmp3-xiao',
    prefix: 'selfmp3',
    keyIdHint: '004abc…',
  }

  it('is news on an account that had nothing, or a bucket', () => {
    expect(driveArrived(null, drive)).toBe(true)
    expect(driveArrived(bucket, drive)).toBe(true)
  })

  it('is not news while nothing has changed', () => {
    expect(driveArrived(null, null)).toBe(false)
    expect(driveArrived(bucket, bucket)).toBe(false)
    expect(driveArrived(drive, drive)).toBe(false)
  })
})

describe('the address as it is sent', () => {
  const typed = {
    endpoint: 's3.us-west-004.backblazeb2.com',
    region: 'auto',
    bucket: 'selfmp3-xiao',
    prefix: 'selfmp3',
    keyId: 'key',
    applicationKey: 'secret',
  }

  it('leaves a typed region out when the address names its own', () => {
    expect(cloudConnectInput(typed)).not.toHaveProperty('region')
  })

  it('sends the region for an address that does not name one', () => {
    expect(
      cloudConnectInput({ ...typed, endpoint: 'abc123.r2.cloudflarestorage.com' }).region,
    ).toBe('auto')
  })
})

describe('moving the library', () => {
  const bucket = {
    kind: 'bucket' as const,
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'my-music',
    prefix: 'selfmp3',
    keyIdHint: '004abc…',
  }
  const drive = { kind: 'drive' as const, folder: '1AbC' }

  it('names the one other place a library can go', () => {
    expect(moveAction(bucket)).toBe('Move your library to Google Drive')
    expect(moveAction(drive)).toBe('Move your library to your own bucket')
  })

  it('says how much room is left, and when that is little', () => {
    const GB = 1024 ** 3
    expect(spaceLine({ used: 10.9 * GB, limit: 15 * GB })).toBe('4.1 GB free of 15 GB')
    expect(spaceLine({ used: 16 * GB, limit: 15 * GB })).toBe('0 MB free of 15 GB')
    expect(spaceLine({ used: 2 * GB, limit: null })).toBe('2.0 GB used')
    expect(spaceLow({ used: 11 * GB, limit: 15 * GB })).toBe(false)
    expect(spaceLow({ used: 12 * GB, limit: 15 * GB })).toBe(true)
    expect(spaceLow({ used: 900 * GB, limit: null })).toBe(false)
  })

  it('says how far a move has got', () => {
    expect(moveProgressLine({ phase: 'songs', done: 412, total: 1930 })).toBe(
      'Moving 412 of 1,930 songs',
    )
    expect(moveProgressLine({ phase: 'rest', done: 3, total: 2400 })).toBe(
      'Moving covers, lyrics and the rest: 3 of 2,400',
    )
  })

  it('says where the library is now, and that the old copy was left', () => {
    expect(movedLine(drive, bucket)).toBe(
      'Your library is now in my-music on Backblaze, us-west-004. The copy in the self.mp3 folder in your Google Drive was left as it was; you can delete it there.',
    )
  })
})
