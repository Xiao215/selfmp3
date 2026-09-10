import { describe, expect, it } from 'vitest'
import type { SyncManifest } from '@selfmp3/shared'
import {
  addEntry,
  bytesToDownload,
  downloadedCount,
  downloadedIds,
  EMPTY_INDEX,
  entryFor,
  fileNameFor,
  isDownloaded,
  parseIndex,
  pendingIds,
  removeEntry,
  staleIds,
  totalBytes,
  type DownloadEntry,
  type DownloadIndex,
} from './downloadIndex'

const entry = (songId: number, patch: Partial<DownloadEntry> = {}): DownloadEntry => ({
  songId,
  fileName: `${songId}.mp3`,
  sizeBytes: 1000,
  etag: `etag-${songId}`,
  downloadedAt: '2025-01-01T00:00:00.000Z',
  ...patch,
})

const withEntries = (...entries: DownloadEntry[]): DownloadIndex =>
  entries.reduce(addEntry, EMPTY_INDEX)

const manifest = (
  entries: { id: number; sizeBytes: number; etag: string }[],
): SyncManifest => ({
  version: 1,
  songCount: entries.length,
  totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
  entries,
})

describe('fileNameFor', () => {
  it('keeps the original extension', () => {
    expect(fileNameFor({ id: 12, path: 'Artist/Album/03 Title.flac' })).toBe('12.flac')
  })

  it('lower-cases the extension', () => {
    expect(fileNameFor({ id: 4, path: 'x/Y.M4A' })).toBe('4.m4a')
  })

  it('falls back to mp3 when there is no usable extension', () => {
    expect(fileNameFor({ id: 7, path: 'no-extension-here' })).toBe('7.mp3')
  })

  it('is not confused by dots in directory names', () => {
    expect(fileNameFor({ id: 9, path: 'A. Artist/track.opus' })).toBe('9.opus')
  })
})

describe('parseIndex', () => {
  it('reads back what was written', () => {
    const index = withEntries(entry(1), entry(2))
    expect(parseIndex(JSON.parse(JSON.stringify(index)))).toEqual(index)
  })

  it('falls back to empty on junk rather than throwing', () => {
    // A corrupt index must never stop the app opening.
    expect(parseIndex('not an index')).toEqual(EMPTY_INDEX)
    expect(parseIndex({ version: 1, entries: { '1': { songId: 'nope' } } })).toEqual(EMPTY_INDEX)
    expect(parseIndex(null)).toEqual(EMPTY_INDEX)
  })

  it('accepts an index with no entries key', () => {
    expect(parseIndex({ version: 1 })).toEqual(EMPTY_INDEX)
  })
})

describe('entries', () => {
  it('adds, finds and removes', () => {
    const index = withEntries(entry(1), entry(2))
    expect(isDownloaded(index, 1)).toBe(true)
    expect(entryFor(index, 2)?.fileName).toBe('2.mp3')
    expect(isDownloaded(removeEntry(index, 1), 1)).toBe(false)
  })

  it('does not mutate the index it was given', () => {
    const index = withEntries(entry(1))
    addEntry(index, entry(2))
    removeEntry(index, 1)
    expect(downloadedIds(index)).toEqual([1])
  })

  it('replaces an existing entry rather than duplicating it', () => {
    const index = addEntry(withEntries(entry(1)), entry(1, { sizeBytes: 50 }))
    expect(downloadedCount(index)).toBe(1)
    expect(totalBytes(index)).toBe(50)
  })

  it('removing something absent is a no-op', () => {
    const index = withEntries(entry(1))
    expect(removeEntry(index, 99)).toBe(index)
  })

  it('sums storage used', () => {
    expect(totalBytes(withEntries(entry(1, { sizeBytes: 10 }), entry(2, { sizeBytes: 32 })))).toBe(42)
    expect(totalBytes(EMPTY_INDEX)).toBe(0)
  })
})

describe('pendingIds', () => {
  it('keeps the requested order', () => {
    const index = withEntries(entry(2))
    expect(pendingIds(index, [3, 2, 1])).toEqual([3, 1])
  })

  it('drops duplicates', () => {
    expect(pendingIds(EMPTY_INDEX, [1, 1, 2, 1])).toEqual([1, 2])
  })

  it('is empty when everything is already downloaded', () => {
    expect(pendingIds(withEntries(entry(1), entry(2)), [1, 2])).toEqual([])
  })
})

describe('staleIds', () => {
  it('flags a file whose etag changed on the server', () => {
    const index = withEntries(entry(1), entry(2))
    const current = manifest([
      { id: 1, sizeBytes: 1000, etag: 'etag-1' },
      { id: 2, sizeBytes: 1000, etag: 'different' },
    ])
    expect(staleIds(index, current)).toEqual([2])
  })

  it('flags a download whose song has left the library', () => {
    const index = withEntries(entry(1), entry(5))
    expect(staleIds(index, manifest([{ id: 1, sizeBytes: 1000, etag: 'etag-1' }]))).toEqual([5])
  })

  it('is empty when everything matches', () => {
    const index = withEntries(entry(1))
    expect(staleIds(index, manifest([{ id: 1, sizeBytes: 1000, etag: 'etag-1' }]))).toEqual([])
  })
})

describe('bytesToDownload', () => {
  it('counts only what is missing', () => {
    const index = withEntries(entry(1))
    const current = manifest([
      { id: 1, sizeBytes: 100, etag: 'etag-1' },
      { id: 2, sizeBytes: 250, etag: 'etag-2' },
      { id: 3, sizeBytes: 400, etag: 'etag-3' },
    ])
    expect(bytesToDownload(index, current, [1, 2, 3])).toBe(650)
  })

  it('ignores ids the manifest does not know about', () => {
    expect(bytesToDownload(EMPTY_INDEX, manifest([]), [1, 2])).toBe(0)
  })
})
