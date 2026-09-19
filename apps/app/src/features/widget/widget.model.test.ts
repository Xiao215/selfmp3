import { describe, expect, it } from 'vitest'
import type { Song, Tag } from '@selfmp3/shared'
import { tagColors } from '@selfmp3/client'

import { snapshotChanged, tagPlayLink, widgetSnapshot } from './widget.model'

const song = (id: number, extra: Partial<Song> = {}): Song =>
  ({ id, title: `Song ${id}`, artist: 'Yorushika', duration: 200, ...extra }) as Song
const tag = (id: number, name: string): Tag => ({ id, name, hue: id * 50, songCount: 3 })

const base = {
  tiles: [1, 2, 3, 4, 5].map(id => ({ tag: tag(id, `t${id}`), songs: id, cover: song(id) })),
  current: song(9, { title: 'ノーチラス' }),
  playing: true,
  position: 88,
  duration: 200,
  now: 1_000_000_000_000,
  coverOf: (item: Song) => (item.id === 1 ? 'AAAA' : ''),
}

describe('the widget snapshot', () => {
  it('has four tiles in the dark tile colours, each linking to play its tag', () => {
    const snapshot = widgetSnapshot(base)
    expect(snapshot.tiles).toHaveLength(4)
    expect(snapshot.tiles[0]).toEqual({
      name: 't1',
      fill: tagColors(50, 'dark').tile,
      ink: tagColors(50, 'dark').tileInk,
      songs: 1,
      link: 'selfmp3://tag/t1?play=1',
      cover: 'AAAA',
    })
    expect(snapshot.tiles[1]?.cover).toBe('')
  })

  it('says when a playing song ends, so the widget counts down by itself', () => {
    const now = widgetSnapshot(base).nowPlaying
    expect(now).toMatchObject({ title: 'ノーチラス', playing: true, remaining: 0 })
    expect(now?.endsAt).toBe(1_000_000_000 + 112)
  })

  it('says how much is left of a paused song', () => {
    const paused = widgetSnapshot({ ...base, playing: false }).nowPlaying
    expect(paused).toMatchObject({ playing: false, endsAt: 0, remaining: 112 })
  })

  it('has nothing playing when nothing is loaded', () => {
    expect(widgetSnapshot({ ...base, current: null }).nowPlaying).toBeNull()
  })

  it('escapes a tag name in its link', () => {
    expect(tagPlayLink('night drive')).toBe('selfmp3://tag/night%20drive?play=1')
  })
})

describe('when to send a new snapshot', () => {
  const first = widgetSnapshot(base)

  it('sends the first, a new song, and play or pause', () => {
    expect(snapshotChanged(null, first)).toBe(true)
    expect(snapshotChanged(first, widgetSnapshot({ ...base, current: song(10) }))).toBe(true)
    expect(snapshotChanged(first, widgetSnapshot({ ...base, playing: false }))).toBe(true)
  })

  it('does not send the position ticking on, which the widget counts itself', () => {
    const later = widgetSnapshot({ ...base, position: 98, now: base.now + 10_000 })
    expect(snapshotChanged(first, later)).toBe(false)
  })

  it('sends a seek, and a change to the tiles', () => {
    expect(snapshotChanged(first, widgetSnapshot({ ...base, position: 20 }))).toBe(true)
    expect(snapshotChanged(first, widgetSnapshot({ ...base, tiles: base.tiles.slice(1) }))).toBe(
      true,
    )
  })
})
