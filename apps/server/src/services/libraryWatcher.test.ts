import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

describe('watching the inbox', () => {
  it('sweeps when audio lands in the folder, and stops when the setting goes off', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-watch-')))
    let watchLibrary = true
    const scan = vi.fn(() => Promise.resolve({ added: 1, updated: 0, total: 1, durationMs: 0 }))
    const watcher = new LibraryWatcherService({
      config: { libraryDir: dir } as Config,
      settings: { get: () => ({ watchLibrary }) as Settings } as SettingsRepository,
      scanner: { isRunning: false, scan } as unknown as ScannerService,
      logger: createLogger('silent'),
    })
    try {
      watcher.apply()
      expect(watcher.isWatching).toBe(true)

      fs.writeFileSync(path.join(dir, '.DS_Store'), '')
      // Written again on each look, spaced past the quiet period so a rewrite
      // never holds the sweep back: a watcher only just started (FSEvents on a
      // Mac) can miss the very first write, and a busy machine makes that likely.
      await vi.waitFor(
        () => {
          if (scan.mock.calls.length === 0) {
            fs.writeFileSync(path.join(dir, 'Artist - Song.m4a'), 'audio')
          }
          expect(scan).toHaveBeenCalled()
        },
        { timeout: 20_000, interval: 4_000 },
      )

      // Turned off from Settings: no restart needed, and nothing more is swept.
      watchLibrary = false
      watcher.apply()
      expect(watcher.isWatching).toBe(false)
      fs.writeFileSync(path.join(dir, 'Another.m4a'), 'audio')
      const swept = scan.mock.calls.length
      await new Promise(resolve => setTimeout(resolve, 2_000))
      expect(scan).toHaveBeenCalledTimes(swept)
    } finally {
      watcher.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
