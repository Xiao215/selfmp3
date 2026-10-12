import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SettingsRepository } from './settings.js'

describe('SettingsRepository', () => {
  it('lets one stored value that no longer fits fall back alone, keeping the rest', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    const settings = new SettingsRepository(db)
    settings.update({ smartWeb: true, importConcurrency: 3 })

    const write = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    write.run('ytCookieSource', JSON.stringify('netscape'))
    write.run('gapless', '{not json')
    write.run('aSettingSinceRemoved', JSON.stringify(1))

    const read = settings.get()
    expect(read.smartWeb).toBe(true)
    expect(read.importConcurrency).toBe(3)
    expect(read.ytCookieSource).toBe(DEFAULT_SETTINGS.ytCookieSource)
    expect(read.gapless).toBe(DEFAULT_SETTINGS.gapless)
    expect(read).not.toHaveProperty('aSettingSinceRemoved')
    db.close()
  })
})
