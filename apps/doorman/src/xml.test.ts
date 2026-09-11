import { describe, expect, it } from 'vitest'
import { parseError, parseListing, unescapeXml } from './xml.js'

/**
 * The XML reader, against answers shaped like B2's: a namespace on the root,
 * the page's own fields around the objects, and owners, ETags and storage
 * classes inside them that must not be mistaken for anything else.
 */

const page = (inner: string): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${inner}</ListBucketResult>`

describe('parseListing', () => {
  it('reads keys, sizes, and whether there is more', () => {
    const listing = parseListing(
      page(
        '<Name>my-music</Name><Prefix>selfmp3/</Prefix><KeyCount>2</KeyCount>' +
          '<MaxKeys>2</MaxKeys><IsTruncated>true</IsTruncated>' +
          '<NextContinuationToken>1ab/cd+ef==</NextContinuationToken>' +
          '<Contents><Key>selfmp3/audio/a.m4a</Key><LastModified>2026-09-11T12:00:00.000Z' +
          '</LastModified><ETag>"x"</ETag><Size>4000000</Size><Owner><ID>1</ID>' +
          '<DisplayName>me</DisplayName></Owner><StorageClass>STANDARD</StorageClass></Contents>' +
          '<Contents>\n  <Key>selfmp3/format.json</Key>\n  <Size>93</Size>\n</Contents>',
      ),
    )
    expect(listing).toEqual({
      objects: [
        { key: 'selfmp3/audio/a.m4a', size: 4_000_000 },
        { key: 'selfmp3/format.json', size: 93 },
      ],
      truncated: true,
      nextToken: '1ab/cd+ef==',
    })
  })

  it('unescapes keys and tokens exactly once', () => {
    const listing = parseListing(
      page(
        '<IsTruncated>true</IsTruncated>' +
          '<NextContinuationToken>a&amp;b&lt;c&#62;&#x3D;</NextContinuationToken>' +
          '<Contents><Key>odd/&lt;/Key&gt; &amp;amp; &quot;q&quot; &apos;s&apos;</Key>' +
          '<Size>1</Size></Contents>',
      ),
    )
    expect(listing?.nextToken).toBe('a&b<c>=')
    expect(listing?.objects).toEqual([{ key: `odd/</Key> &amp; "q" 's'`, size: 1 }])
  })

  it('knows the last page, and an empty folder', () => {
    expect(parseListing(page('<KeyCount>0</KeyCount><IsTruncated>false</IsTruncated>'))).toEqual({
      objects: [],
      truncated: false,
      nextToken: null,
    })
  })

  it('refuses what is not a listing', () => {
    expect(parseListing('<html><body>Service Unavailable</body></html>')).toBeNull()
    expect(parseListing('<Error><Code>AccessDenied</Code></Error>')).toBeNull()
    expect(parseListing('')).toBeNull()
  })
})

describe('parseError', () => {
  it('reads the code and message of an S3 error', () => {
    expect(
      parseError(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Error>' +
          '<Code>NoSuchBucket</Code><Message>Bucket &quot;x&quot; does not exist</Message></Error>',
      ),
    ).toEqual({ code: 'NoSuchBucket', message: 'Bucket "x" does not exist' })
  })

  it('finds nothing in an answer that is not an error', () => {
    expect(parseError('')).toEqual({ code: null, message: null })
    expect(parseError('<ListBucketResult><Code>x</Code></ListBucketResult>')).toEqual({
      code: null,
      message: null,
    })
  })
})

describe('unescapeXml', () => {
  it('leaves what it does not know alone', () => {
    expect(unescapeXml('&nbsp; &#0; &#xD800; &#1114112; & plain')).toBe(
      '&nbsp; &#0; &#xD800; &#1114112; & plain',
    )
    expect(unescapeXml('&#x1F3B5;')).toBe('🎵')
  })
})
