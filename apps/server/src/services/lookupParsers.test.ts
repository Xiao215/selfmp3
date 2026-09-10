import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  coverArtArchiveUrl,
  parseItunes,
  parseMusicBrainz,
  upsizeItunesArtwork,
} from './lookupParsers.js'

/**
 * Fixtures are trimmed copies of what the live APIs return, with a couple of
 * deliberately malformed entries mixed in — the parsers have to skip those
 * rather than reject the whole response.
 */
function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

const query = { title: 'Bohemian Rhapsody', artist: 'Queen', album: '', duration: 355 }

describe('parseItunes', () => {
  const candidates = parseItunes(fixture('itunes-search.json'), query)

  it('keeps songs and skips audiobooks and junk', () => {
    expect(candidates).toHaveLength(2)
    expect(candidates.every(c => c.source === 'itunes')).toBe(true)
  })

  it('normalises every field of a track', () => {
    expect(candidates[0]).toMatchObject({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera (Deluxe Edition)',
      year: 1975,
      trackNo: 11,
      durationSec: 354,
      score: 1,
    })
    expect(candidates[0]?.albumArtist).toBeUndefined()
  })

  it('upsizes the 100px artwork to 600px', () => {
    expect(candidates[0]?.artworkUrl).toMatch(/\/600x600bb\.jpg$/)
    expect(upsizeItunesArtwork('https://x/y/100x100bb.jpg')).toBe('https://x/y/600x600bb.jpg')
  })

  it('scores the live version lower than the studio one', () => {
    expect(candidates[1]?.score).toBeLessThan(candidates[0]?.score ?? 0)
  })

  it('returns nothing for a body that is not a search response', () => {
    expect(parseItunes({ errorMessage: 'Invalid value' }, query)).toEqual([])
    expect(parseItunes('<html>', query)).toEqual([])
    expect(parseItunes(null, query)).toEqual([])
  })
})

describe('parseMusicBrainz', () => {
  const matches = parseMusicBrainz(fixture('musicbrainz-recording.json'), query)

  it('produces one candidate per well-formed recording', () => {
    expect(matches).toHaveLength(3)
    expect(matches.every(m => m.candidate.source === 'musicbrainz')).toBe(true)
  })

  it('describes a recording by its official release, not the bootleg', () => {
    const [best] = matches
    expect(best?.candidate).toMatchObject({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      albumArtist: 'Queen',
      year: 1975,
      trackNo: 11,
      durationSec: 355,
      score: 1,
    })
    // Official first, so the Cover Art Archive is asked about the right one.
    expect(best?.releaseIds[0]).toBe('8e9b7a34-2d09-4e5c-9b3e-0f5f9d5e5a61')
    expect(best?.releaseIds).toHaveLength(2)
  })

  it('joins split artist credits and ignores vinyl side letters as track numbers', () => {
    const live = matches[1]?.candidate
    expect(live?.artist).toBe('Queen feat. Elton John')
    expect(live?.trackNo).toBeUndefined()
    expect(live?.year).toBe(1992)
  })

  it('copes with a recording that has no releases or length', () => {
    const bare = matches[2]
    expect(bare?.candidate).toMatchObject({ artist: 'Some Cover Band', album: '' })
    expect(bare?.candidate.durationSec).toBeUndefined()
    expect(bare?.releaseIds).toEqual([])
  })

  it('never sets an artwork URL itself — that needs the archive check', () => {
    expect(matches.every(m => m.candidate.artworkUrl === undefined)).toBe(true)
    expect(coverArtArchiveUrl('abc')).toBe('https://coverartarchive.org/release/abc/front-500')
  })

  it('returns nothing for an error body', () => {
    expect(parseMusicBrainz({ error: 'Rate limited', help: '...' }, query)).toEqual([])
    expect(parseMusicBrainz(undefined, query)).toEqual([])
  })
})
