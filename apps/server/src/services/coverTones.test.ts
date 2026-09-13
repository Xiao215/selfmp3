import { describe, expect, it, vi } from 'vitest'
import type { CoverTone } from '@selfmp3/shared'
import { createLogger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import type { CoverService } from './covers.js'
import { CoverToneService } from './coverTones.js'

/** Songs waiting for a colour, and what was written back for each. */
function fakeSongs(pending: Array<{ id: number; artRev: number }>): {
  songs: SongRepository
  written: Array<[number, number, CoverTone | null]>
} {
  const queue = [...pending]
  const written: Array<[number, number, CoverTone | null]> = []
  const songs = {
    nextWithoutCoverTone: () => queue[0] ?? null,
    setCoverTone: (id: number, artRev: number, tone: CoverTone | null) => {
      written.push([id, artRev, tone])
      queue.splice(
        queue.findIndex(song => song.id === id),
        1,
      )
    },
  } as unknown as SongRepository
  return { songs, written }
}

const coversAt = (present: number[]): CoverService =>
  ({
    find: (id: number) =>
      present.includes(id) ? { path: `/covers/${id}.png`, contentType: 'image/png' } : null,
  }) as unknown as CoverService

describe('CoverToneService', () => {
  it('keeps each cover’s colour against the revision it was read from, and says so once', async () => {
    const { songs, written } = fakeSongs([
      { id: 1, artRev: 0 },
      { id: 2, artRev: 3 },
    ])
    const onChange = vi.fn()
    const read = vi.fn((file: string) =>
      Promise.resolve(file.includes('/1.') ? { hue: 270, chroma: 0.1 } : null),
    )
    new CoverToneService({
      songs,
      covers: coversAt([1, 2]),
      logger: createLogger('silent'),
      onChange,
      read,
    }).kick()

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(written).toEqual([
      [1, 0, { hue: 270, chroma: 0.1 }],
      [2, 3, null],
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('remembers a cover it could not read, so it is not read again and again', async () => {
    const { songs, written } = fakeSongs([
      { id: 1, artRev: 0 },
      { id: 2, artRev: 0 },
    ])
    const onChange = vi.fn()
    const read = vi.fn(() => Promise.reject(new Error('not an image')))
    new CoverToneService({
      songs,
      // Song 2 says it has art, but the file is gone.
      covers: coversAt([1]),
      logger: createLogger('silent'),
      onChange,
      read,
    }).kick()

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(written).toEqual([
      [1, 0, null],
      [2, 0, null],
    ])
    expect(read).toHaveBeenCalledTimes(1)
  })
})
