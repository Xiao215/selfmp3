import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { BucketDownloadsRepository } from './bucketDownloads.js'

describe('BucketDownloadsRepository', () => {
  it('counts a day’s downloads, and starts again on the next day', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    const downloads = new BucketDownloadsRepository(db)
    expect(downloads.spentOn('2026-10-07')).toBe(0)
    downloads.spend('2026-10-07')
    downloads.spend('2026-10-07')
    expect(downloads.spentOn('2026-10-07')).toBe(2)
    // Read by a new run of the server: the count is the database's, not the process's.
    expect(new BucketDownloadsRepository(db).spentOn('2026-10-07')).toBe(2)

    downloads.spend('2026-10-08')
    expect(downloads.spentOn('2026-10-08')).toBe(1)
    expect(downloads.spentOn('2026-10-07')).toBe(0)
    db.close()
  })
})
