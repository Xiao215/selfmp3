import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import { CloudError } from '../bucket/store.js'
import { createLogger } from '../logger.js'
import { romanizeLibrary } from './romanizedLines.js'
import type { LyricsCache } from './lyricsCache.js'
import type { RomanizationService } from './romanization.js'

/**
 * The romaji backfill after boot, against a bucket that will not answer: it
 * stops at the first refusal rather than asking once per song.
 */
describe('romanizeLibrary', () => {
  const song = (id: number): Song => ({ id, path: `audio/${id}.m4a`, lyricsKind: 'synced' }) as Song

  it('stops at the first refusal from the bucket, and goes on past any other trouble', async () => {
    const asked: number[] = []
    const refusing = {
      songs: { all: () => [song(1), song(2), song(3)] },
      lyrics: {
        stored: (songId: number) => {
          asked.push(songId)
          return Promise.reject(new CloudError('auth', 'The bucket refused the key.'))
        },
      },
      metadata: { read: () => Promise.resolve({ embeddedLyrics: null }) },
      lyricsCache: { read: () => Promise.resolve(null) } as unknown as LyricsCache,
      romanization: {} as RomanizationService,
      logger: createLogger('silent'),
    }
    expect(await romanizeLibrary(refusing)).toBe(0)
    expect(asked).toEqual([1])

    const broken = {
      ...refusing,
      lyrics: {
        stored: (songId: number) => {
          asked.push(songId)
          return Promise.reject(new Error('unreadable file'))
        },
      },
    }
    asked.length = 0
    expect(await romanizeLibrary(broken)).toBe(0)
    expect(asked).toEqual([1, 2, 3])
  })
})
