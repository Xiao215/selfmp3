import { describe, expect, it } from 'vitest'
import { isRelevantChange } from './libraryWatcher.js'

describe('isRelevantChange', () => {
  it('accepts audio and lyric files, in subfolders too', () => {
    expect(isRelevantChange('Artist - Song.m4a')).toBe(true)
    expect(isRelevantChange('sub/dir/track.MP3')).toBe(true)
    expect(isRelevantChange('Artist - Song.lrc')).toBe(true)
    expect(isRelevantChange('notes.txt')).toBe(true)
  })

  it('ignores Finder noise and unrelated files', () => {
    expect(isRelevantChange('.DS_Store')).toBe(false)
    expect(isRelevantChange('._Artist - Song.m4a')).toBe(false)
    expect(isRelevantChange('sub/.hidden.m4a')).toBe(false)
    expect(isRelevantChange('cover.jpg')).toBe(false)
    expect(isRelevantChange('download.m4a.part')).toBe(false)
    expect(isRelevantChange(null)).toBe(false)
    expect(isRelevantChange('')).toBe(false)
  })
})
