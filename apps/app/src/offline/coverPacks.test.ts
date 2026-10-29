import { describe, expect, it } from 'vitest'
import type { CloudCoverPack } from '@selfmp3/shared'
import { namesDigest, packsToFetch } from './coverPacks'

/** A pack of `count` covers of `size` bytes, named `<prefix><n>.jpg`. */
const pack = (prefix: string, count: number, size: number): CloudCoverPack => ({
  key: `covers/${prefix}.pack`,
  size: count * size,
  covers: Array.from({ length: count }, (_, at): [string, number] => [
    `covers/${prefix}${at}.jpg`,
    size,
  ]),
})

const keysOf = (fetched: CloudCoverPack): Set<string> => new Set(fetched.covers.map(([key]) => key))

describe('packsToFetch', () => {
  it('fetches every pack a device with nothing needs', () => {
    const packs = [pack('a', 80, 100), pack('b', 30, 100)]
    const wanted = new Set([
      ...keysOf(packs[0] as CloudCoverPack),
      ...keysOf(packs[1] as CloudCoverPack),
    ])
    const fetches = packsToFetch(packs, wanted, () => false)
    expect(fetches.map(fetch => fetch.pack.key)).toEqual(['covers/a.pack', 'covers/b.pack'])
    expect(fetches[0]?.slices[1]).toEqual({ name: 'a1.jpg', at: 100, size: 100 })
  })

  it('fetches a few missing covers alone rather than a pack it mostly has', () => {
    const big = pack('a', 80, 100)
    const wanted = keysOf(big)
    // Two of eighty missing: two reads alone, not 8 KB of what is here.
    const few = packsToFetch([big], wanted, name => name !== 'a3.jpg' && name !== 'a7.jpg')
    expect(few).toEqual([])
    // Eight missing: one read for the pack.
    const many = packsToFetch([big], wanted, name => !/^a[0-7]\.jpg$/.test(name))
    expect(many[0]?.slices).toHaveLength(8)
  })

  it('fetches a pack for a few covers that are most of its bytes', () => {
    const small = pack('a', 3, 100)
    const fetches = packsToFetch([small], keysOf(small), name => name === 'a0.jpg')
    expect(fetches[0]?.slices.map(slice => slice.name)).toEqual(['a1.jpg', 'a2.jpg'])
  })

  it('leaves out what the library no longer names, and a cover a pack before brings', () => {
    const first = pack('a', 3, 100)
    const second: CloudCoverPack = {
      key: 'covers/b.pack',
      size: 300,
      covers: [
        ['covers/a2.jpg', 100],
        ['covers/b0.jpg', 100],
        ['covers/b1.jpg', 100],
      ],
    }
    const wanted = new Set(['covers/a0.jpg', 'covers/a1.jpg', 'covers/a2.jpg', 'covers/b0.jpg'])
    const fetches = packsToFetch([first, second], wanted, () => false)
    expect(fetches.map(fetch => fetch.keys)).toEqual([
      ['covers/a0.jpg', 'covers/a1.jpg', 'covers/a2.jpg'],
    ])
  })
})

describe('namesDigest', () => {
  it('says whether a name is the hash of the bytes', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cover'))
    const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    expect(namesDigest(`${hex}.jpg`, digest)).toBe(true)
    expect(namesDigest(`${'0'.repeat(64)}.jpg`, digest)).toBe(false)
  })
})
