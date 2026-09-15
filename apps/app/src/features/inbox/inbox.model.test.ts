import { describe, expect, it } from 'vitest'

import {
  existingTag,
  inboxSubtitle,
  isUntagged,
  nextLabel,
  orderedTags,
  sessionSummary,
  tagForKey,
  tagOrder,
  toggled,
  untaggedSongs,
} from './inbox.model'

const song = (
  id: number,
  patch: Partial<{ tagIds: number[]; missing: boolean; addedAt: string; duration: number }>,
) => ({
  id,
  tagIds: [] as number[],
  missing: false,
  addedAt: '2026-09-01T00:00:00Z',
  duration: 200,
  ...patch,
})

describe('the untagged list', () => {
  it('holds songs with no tag whose files are here, newest first', () => {
    const songs = [
      song(1, { addedAt: '2026-09-01T00:00:00Z' }),
      song(2, { tagIds: [7] }),
      song(3, { missing: true }),
      song(4, { addedAt: '2026-09-10T00:00:00Z' }),
    ]
    expect(isUntagged(songs[1]!)).toBe(false)
    expect(untaggedSongs(songs).map(s => s.id)).toEqual([4, 1])
  })

  it('says how many and how long, and nothing once every song has a tag', () => {
    expect(inboxSubtitle(true, [])).toBe('Loading…')
    // "All tagged" on the page says it; the subtitle does not say it again.
    expect(inboxSubtitle(false, [])).toBeNull()
    expect(inboxSubtitle(false, [song(1, { duration: 400 }), song(2, { duration: 260 })])).toBe(
      '2 songs without a tag · 11 min · newest first',
    )
  })
})

describe('tagging one song at a time', () => {
  const tags = [
    { id: 1, name: 'yoasobi', songCount: 13 },
    { id: 2, name: 'reference', songCount: 6 },
    { id: 3, name: 'chill', songCount: 6 },
  ]

  it('orders tags by use, then name, and keeps new ones at the end', () => {
    const order = tagOrder(tags)
    expect(order).toEqual([1, 3, 2])
    expect(
      orderedTags(order, [...tags, { id: 9, name: 'new', songCount: 0 }]).map(t => t.id),
    ).toEqual([1, 3, 2, 9])
  })

  it('maps 1–9 to the first nine tags', () => {
    const ordered = orderedTags(tagOrder(tags), tags)
    expect(tagForKey('2', ordered)?.name).toBe('chill')
    expect(tagForKey('0', ordered)).toBeUndefined()
    expect(tagForKey('n', ordered)).toBeUndefined()
  })

  it('toggles a tag, and finds a typed name whatever its case', () => {
    expect([...toggled(new Set([1]), 2)].sort()).toEqual([1, 2])
    expect([...toggled(new Set([1, 2]), 1)]).toEqual([2])
    expect(existingTag(tags, '  Chill ')?.id).toBe(3)
    expect(existingTag(tags, 'jazz')).toBeUndefined()
  })

  it('calls moving on Skip, Next or Finish', () => {
    expect(nextLabel(0, 3, 0)).toBe('Skip')
    expect(nextLabel(1, 3, 2)).toBe('Next')
    expect(nextLabel(2, 3, 0)).toBe('Finish')
  })

  it('sums up the session', () => {
    const queue = [song(1, {}), song(2, {}), song(3, { tagIds: [1] })]
    expect(sessionSummary(queue, new Map([[1, new Set([2])]]))).toEqual({
      title: 'Tagged 2 of 3',
      hint: '1 still untagged — they stay in the list for next time.',
    })
    expect(sessionSummary([], new Map()).title).toBe('Nothing left to tag')
  })
})
