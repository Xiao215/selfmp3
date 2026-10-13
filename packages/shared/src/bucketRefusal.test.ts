import { describe, expect, it } from 'vitest'
import { bucketUnreachable, classifyBucketRefusal } from './bucketRefusal.js'

/**
 * The doorman and the server read a bucket's refusal with this one function,
 * the doorman from S3's XML and the server from the SDK's error.
 */

const WHERE = {
  bucket: 'my-music',
  host: 's3.us-west-004.backblazeb2.com',
  secrets: ['K004secretapplicationkey', '004keyid'],
}

describe('classifyBucketRefusal', () => {
  it('names a bucket that is not there', () => {
    expect(
      classifyBucketRefusal({ status: 404, code: 'NoSuchBucket', message: 'gone' }, WHERE),
    ).toEqual({
      kind: 'missing',
      message: `There is no bucket called “my-music” at ${WHERE.host}.`,
    })
  })

  it('tells a used-up cap from a refused key, though Backblaze sends both as a 403', () => {
    const cap = classifyBucketRefusal(
      { status: 403, code: 'AccessDenied', message: 'Transaction cap exceeded' },
      WHERE,
    )
    expect(cap.kind).toBe('cap')
    expect(cap.message).toMatch(/allowance for today is used up/)

    const key = classifyBucketRefusal(
      { status: 403, code: 'InvalidAccessKeyId', message: 'The key is not valid' },
      WHERE,
    )
    expect(key.kind).toBe('auth')
    expect(key.message).toMatch(/refused the key \(InvalidAccessKeyId\).*“my-music”/)
    expect(key.message).toMatch(/Backblaze said “The key is not valid”/)
  })

  /* The server's copy repeated the bucket's words with the key still in them. */
  it('never repeats the key, whatever the bucket said', () => {
    const said = classifyBucketRefusal(
      {
        status: 400,
        code: 'InvalidRequest',
        message: 'bad key K004secretapplicationkey for 004keyid',
      },
      WHERE,
    )
    expect(said.kind).toBe('other')
    expect(said.message).toBe(`${WHERE.host}: bad key … for … (InvalidRequest)`)
  })

  it('says what status came back when the bucket said nothing', () => {
    expect(classifyBucketRefusal({ status: 500, code: null, message: null }, WHERE).message).toBe(
      `${WHERE.host}: it answered 500`,
    )
  })
})

describe('bucketUnreachable', () => {
  it('is a network failure, by the host', () => {
    expect(bucketUnreachable(WHERE.host)).toEqual({
      kind: 'network',
      message: `Could not reach ${WHERE.host}.`,
    })
  })
})
