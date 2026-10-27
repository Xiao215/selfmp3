import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import { TAKE_TONES, takeTone, type MapTake } from './sky.model'
import { trayOrder, traySections } from './tray.model'

const song = (id: number): Song => ({ id, title: `Song ${id}` }) as Song
const library = new Map([1, 2, 3, 4, 5, 6].map(id => [id, song(id)]))
const take = (id: number, ids: number[], tone: string = TAKE_TONES[0]): MapTake => ({
  id,
  kind: 'loop',
  tone,
  name: `Take ${id}`,
  ids,
  chain: ids,
  path: [],
})

describe('the tray', () => {
  it('is a section a stroke, numbered across them, each song once', () => {
    const sections = traySections([take(1, [1, 2, 3]), take(2, [3, 4, 5])], new Set(), library)
    expect(sections.map(section => section.songs.map(each => each.id))).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
    expect(sections.map(section => section.first)).toEqual([1, 4])
    expect(trayOrder(sections)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps a left-out song with the stroke that took it, to bring back', () => {
    const sections = traySections([take(1, [1, 2]), take(2, [2, 6])], new Set([2]), library)
    expect(sections[0]).toMatchObject({ left: [2], first: 1 })
    expect(sections[1]).toMatchObject({ left: [], first: 2 })
    expect(trayOrder(sections)).toEqual([1, 6])
  })

  it('drops a song no longer in the library', () => {
    expect(trayOrder(traySections([take(1, [1, 99, 2])], new Set(), library))).toEqual([1, 2])
  })

  it('gives a new stroke a colour no stroke in it wears', () => {
    expect(takeTone([])).toBe(TAKE_TONES[0])
    expect(takeTone([take(1, [], TAKE_TONES[0]), take(2, [], TAKE_TONES[2])])).toBe(TAKE_TONES[1])
    const full = TAKE_TONES.map((tone, index) => take(index, [], tone))
    expect(TAKE_TONES).toContain(takeTone(full))
  })
})
