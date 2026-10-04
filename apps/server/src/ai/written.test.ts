import { describe, expect, it } from 'vitest'
import type { Wrapped } from '@selfmp3/shared'
import { scriptedLlm } from './fixtures/library.js'
import { Remembered } from './llm.js'
import { factsOf, keepTrue, written } from './written.js'

const WRAPPED: Wrapped = {
  range: 'month',
  from: '2026-09-03T00:00:00Z',
  to: '2026-10-03T00:00:00Z',
  totals: { plays: 75, minutes: 190, songsPlayed: 72, activeDays: 5 },
  topSongs: [
    {
      songId: 1,
      title: 'A Shard From Past Glories',
      artist: 'HOYO-MiX',
      hasArt: true,
      plays: 2,
      minutes: 4,
    },
  ],
  topArtists: [{ key: 'HOYO-MiX', plays: 32, minutes: 80 }],
  topTags: [{ key: '原神纯音乐', plays: 47, minutes: 120 }],
  peakHour: { hour: 15, plays: 20 },
  peakWeekday: { weekday: 5, plays: 25 },
  busiestDate: { date: '2026-10-02', plays: 25 },
  longestStreakDays: 3,
  mostInOneDay: null,
  discovered: [],
  personality: { traits: ['Explorer'], line: 'Explorer' },
}

describe('your month, written', () => {
  const facts = factsOf(WRAPPED)

  it('gives the model hours beside minutes and the hour as a person says it', () => {
    expect(facts).toContain('190 minutes (3 hours)')
    expect(facts).toContain('Busiest hour of the day: 3 pm (20 plays)')
    expect(facts).toContain('Busiest day of the week: Friday (25 plays)')
  })

  it('keeps a sentence only when its numbers and names are the facts’', () => {
    expect(
      keepTrue(
        [
          'You played 75 times over 5 days, about 3 hours.',
          'October 2 was your biggest day, with 25 plays.',
          // 80 is HOYO-MiX's minutes in the facts' data, but never written in them.
          'You gave HOYO-MiX 80 minutes.',
          // Respelled: 乨 for 乐.
          'Mostly 原神纯音乨.',
          'Mostly 原神纯音乐, 47 plays of it.',
          '1,342 songs were waiting.',
        ],
        facts,
      ),
    ).toEqual([
      'You played 75 times over 5 days, about 3 hours.',
      'October 2 was your biggest day, with 25 plays.',
      'Mostly 原神纯音乐, 47 plays of it.',
    ])
  })

  it('says how many it left out, and asks again only when told to', async () => {
    const llm = scriptedLlm({
      written: [
        { sentences: ['You played 75 times.', 'You played 76 times.'] },
        { sentences: ['Again: 75 plays.'] },
      ],
    })
    const deps = { llm, wrapped: () => WRAPPED }
    const remembered = new Remembered()
    expect(await written({ ...deps, remembered }, 'month')).toEqual({
      range: 'month',
      sentences: ['You played 75 times.'],
      dropped: 1,
    })
    expect((await written({ ...deps, remembered }, 'month')).sentences).toEqual([
      'You played 75 times.',
    ])
    expect((await written({ ...deps, remembered }, 'month', true)).sentences).toEqual([
      'Again: 75 plays.',
    ])
  })

  it('writes nothing for a period with no plays', async () => {
    const llm = scriptedLlm({})
    const empty = { ...WRAPPED, totals: { ...WRAPPED.totals, plays: 0 } }
    expect(await written({ llm, wrapped: () => empty }, 'week')).toEqual({
      range: 'week',
      sentences: [],
      dropped: 0,
    })
  })
})
