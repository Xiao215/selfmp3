import {
  MigrateEnqueueSchema,
  type MigrateCandidate,
  type MigrateMatchItem,
  type MigrateMatchJob,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  chosenRows,
  confidenceLevel,
  enqueueRequest,
  importSongsLabel,
  initialChosen,
  matchedHeading,
  matchedIndexes,
  matchingHeading,
  migrateRows,
  pendingNote,
  percent,
  queuedMessage,
  skippedNote,
  stageOf,
} from './migrate.model'

const candidate = (title: string, confidence: number): MigrateCandidate => ({
  url: `https://www.youtube.com/watch?v=${title}`,
  title,
  channel: 'YOASOBI',
  duration: 250,
  thumbnail: null,
  confidence,
})

const item = (
  title: string,
  candidates: MigrateCandidate[],
  alreadyHave = false,
): MigrateMatchItem => ({
  source: { title, artist: 'YOASOBI', album: '', duration: 0 },
  candidates,
  alreadyHave,
  error: candidates.length === 0 ? 'No results' : null,
})

const job = (patch: Partial<MigrateMatchJob>): MigrateMatchJob => ({
  id: 'j',
  status: 'done',
  total: 4,
  completed: 4,
  items: [
    item('群青', [candidate('群青 MV', 0.9), candidate('群青 live', 0.6)]),
    item('アイドル', [candidate('アイドル MV', 0.92)], true),
    item('ハルカ', [candidate('ハルカ cover', 0.3)]),
    item('夜に駆ける', []),
  ],
  ...patch,
})

describe('migration stages', () => {
  it('pastes, then matches, then reviews', () => {
    expect(stageOf(null)).toBe('input')
    expect(stageOf({ status: 'running' })).toBe('matching')
    expect(stageOf({ status: 'done' })).toBe('review')
    expect(stageOf({ status: 'cancelled' })).toBe('review')
  })

  it('shows searched tracks while the rest are still being looked for', () => {
    const running = job({
      status: 'running',
      completed: 2,
      items: [job({}).items[0]!, null, null, null],
    })
    const rows = migrateRows(running, new Map())
    expect(rows).toHaveLength(1)
    expect(matchingHeading(running)).toBe('Matching 2 of 4')
    expect(pendingNote(running, rows)).toBe('Searching… 3 to go')
    expect(pendingNote(job({}), migrateRows(job({}), new Map()))).toBeNull()
  })
})

describe('migration review', () => {
  const rows = migrateRows(job({}), new Map())

  it('ticks only confident matches the library does not have', () => {
    expect([...initialChosen(job({}))]).toEqual([0])
  })

  it('uses the best upload unless another was picked', () => {
    expect(rows[0]!.match?.title).toBe('群青 MV')
    expect(migrateRows(job({}), new Map([[0, 1]]))[0]!.match?.title).toBe('群青 live')
    expect(rows[3]!.match).toBeNull()
  })

  it('counts what matched, and lets only those be ticked', () => {
    expect(matchedHeading(rows)).toBe('3 of 4 songs matched')
    expect([...matchedIndexes(rows)]).toEqual([0, 1, 2])
    expect(chosenRows(rows, new Set([0, 3])).map(row => row.index)).toEqual([0])
  })

  it('names how sure a match is in words and marks, not colour alone', () => {
    expect(confidenceLevel(0.92)).toEqual({ tone: 'good', word: 'Strong', mark: '✓' })
    expect(confidenceLevel(0.5).word).toBe('Likely')
    expect(confidenceLevel(0.49).word).toBe('Weak')
    expect(percent(0.904)).toBe('90%')
  })

  it('imports the source’s names with the upload’s audio', () => {
    const request = enqueueRequest(rows, new Set([0, 2]), {
      tagIds: new Set([7]),
      playlistName: '  From Spotify ',
    })
    expect(request.items).toEqual([
      expect.objectContaining({ url: rows[0]!.match!.url, title: '群青', duration: 250 }),
      expect.objectContaining({ title: 'ハルカ' }),
    ])
    expect(request.playlistName).toBe('From Spotify')
    expect(MigrateEnqueueSchema.safeParse(request).success).toBe(true)
  })

  it('makes no playlist when the name is left empty', () => {
    expect(
      enqueueRequest(rows, new Set([0]), { tagIds: new Set(), playlistName: ' ' }).playlistName,
    ).toBeNull()
  })

  it('says which lines it could not read, and the counts in words', () => {
    expect(skippedNote({ skipped: ['a', 'b', 'c', 'd'] })).toBe(
      'Could not read 4 lines: a · b · c …',
    )
    expect(skippedNote({ skipped: ['x'] })).toBe('Could not read 1 line: x')
    expect(skippedNote({ skipped: [] })).toBeNull()
    expect(importSongsLabel(1)).toBe('Import 1 song')
    expect(queuedMessage(3)).toBe('3 songs queued.')
  })
})
