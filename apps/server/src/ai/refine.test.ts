import { describe, expect, it } from 'vitest'
import type { Understanding } from '@selfmp3/shared'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'
import { songsFitting } from './describe.js'
import { refine } from './refine.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')

const jpop: Understanding = {
  name: 'Jpop',
  anyTags: ['jpop'],
  artists: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: 1,
  brief: null,
}

const deps = (llm: ReturnType<typeof scriptedLlm>) => ({
  llm,
  songs: () => SONGS,
  tags: () => TAGS,
  now: () => NOW,
})

const fitting = songsFitting(SONGS, TAGS, jpop, NOW).map(song => song.id)

describe('changing an answer', () => {
  it('keeps the songs shown and adds the rest when only the count changes', async () => {
    const llm = scriptedLlm({ 'refine-plan': [{ ...jpop, size: 3 }] })
    const shown = [fitting[1]!]
    const result = await refine(deps(llm), {
      text: 'some jpop',
      understanding: jpop,
      change: '3 songs',
      shown,
    })
    expect(result.picks[0]?.songId).toBe(shown[0])
    expect(result.picks).toHaveLength(3)
    expect(new Set(result.picks.map(pick => pick.songId)).size).toBe(3)
    expect(result.understanding.size).toBe(3)
    // The change was read once; nothing was picked by the model (all that fit was taken).
    expect(llm.asked.map(request => request.task)).toEqual(['refine-plan'])
  })

  it('keeps only the first ones when the count goes down', async () => {
    const llm = scriptedLlm({ 'refine-plan': [{ ...jpop, size: 1 }] })
    const result = await refine(deps(llm), {
      text: 'some jpop',
      understanding: { ...jpop, size: 3 },
      change: 'just one',
      shown: fitting,
    })
    expect(result.picks.map(pick => pick.songId)).toEqual([fitting[0]])
  })

  it('drops a song the change rules out', async () => {
    const llm = scriptedLlm({
      'refine-plan': [{ ...jpop, size: 2, anyTags: ['古典'] }],
      'describe-pick': [
        {
          picks: [
            { n: 1, why: 'a' },
            { n: 2, why: 'b' },
          ],
        },
      ],
    })
    const result = await refine(deps(llm), {
      text: 'some jpop',
      understanding: { ...jpop, size: 2 },
      change: 'classical instead',
      shown: fitting.slice(0, 2),
    })
    const classical = songsFitting(SONGS, TAGS, { ...jpop, anyTags: ['古典'] }, NOW).map(s => s.id)
    for (const pick of result.picks) expect(classical).toContain(pick.songId)
  })
})
