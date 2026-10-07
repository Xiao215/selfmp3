import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '@selfmp3/shared'
import type { Config } from '../config.js'
import { createLogger } from '../logger.js'
import type { SettingsRepository } from '../repositories/settings.js'
import { isRelevantChange, LibraryWatcherService } from './libraryWatcher.js'
import type { ScannerService } from './scanner.js'

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

describe('the automatic rescan', () => {
  it('follows autoScanMinutes each time the settings are applied', async () => {
    vi.useFakeTimers()
    try {
      let minutes = 0
      const scan = vi.fn(() => Promise.resolve({ added: 1, updated: 0, total: 1, durationMs: 0 }))
      const onChanged = vi.fn()
      const watcher = new LibraryWatcherService({
        // The folder is not watched, so only the timer is in play.
        config: {} as Config,
        settings: {
          get: () => ({ watchLibrary: false, autoScanMinutes: minutes }) as Settings,
        } as SettingsRepository,
        scanner: { isRunning: false, scan } as unknown as ScannerService,
        onChanged,
        logger: createLogger('silent'),
      })

      watcher.apply()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(scan).not.toHaveBeenCalled()

      // Turned on from Settings: no restart needed.
      minutes = 5
      watcher.apply()
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(scan).toHaveBeenCalledTimes(1)
      expect(onChanged).toHaveBeenCalledTimes(1)

      minutes = 0
      watcher.apply()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(scan).toHaveBeenCalledTimes(1)
      watcher.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
