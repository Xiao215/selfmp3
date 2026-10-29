import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RomanizedLyrics, Song } from '@selfmp3/shared'
import { CloudError } from '../bucket/store.js'
import type { Config } from '../config.js'
import { createLogger } from '../logger.js'
import { keepRomanizedFromBucket, romanizeLibrary } from './romanizedLines.js'
import { LyricsCache } from './lyricsCache.js'
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

/**
 * The romaji a words file in the bucket carries, kept as this server's own,
 * so a server rebuilt from the bucket does not make every song's again.
 */
describe('keepRomanizedFromBucket', () => {
  let dataDir = ''

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  const cache = (): LyricsCache => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-romanized-'))
    return new LyricsCache({ dataDir } as Config, createLogger('silent'))
  }
  const text = '[00:01.00]你好\n[00:02.50]hello'
  const kept = (lyricsCache: LyricsCache): Promise<RomanizedLyrics | null> =>
    lyricsCache.read<RomanizedLyrics>(4, 'romanized', LyricsCache.hash(text))

  it('keeps the lines under the text, timed as the text is', async () => {
    const lyricsCache = cache()
    await keepRomanizedFromBucket({ lyricsCache }, 4, text, ['nǐ hǎo', ''])

    expect(await kept(lyricsCache)).toEqual({
      language: 'zh',
      synced: true,
      lines: [
        { time: 1, text: '你好', romanized: 'nǐ hǎo' },
        { time: 2.5, text: 'hello', romanized: '' },
      ],
    })
  })

  it('leaves alone romaji made here, and lines that do not line up', async () => {
    const lyricsCache = cache()
    await keepRomanizedFromBucket({ lyricsCache }, 4, text, ['one line for two'])
    expect(await kept(lyricsCache)).toBeNull()

    await keepRomanizedFromBucket({ lyricsCache }, 4, text, ['made here', ''])
    await keepRomanizedFromBucket({ lyricsCache }, 4, text, ['from the bucket', ''])
    expect((await kept(lyricsCache))?.lines[0]?.romanized).toBe('made here')
  })
})
