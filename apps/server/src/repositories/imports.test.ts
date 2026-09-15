import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { ImportRepository } from './imports.js'

/**
 * The queue's two decisions the worker leans on, against a real in-memory
 * SQLite built from the real migrations: which job runs next, and whether it
 * is still too early to call one off.
 */

describe('ImportRepository', () => {
  let imports: ImportRepository

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    imports = new ImportRepository(db)
  })

  const enqueue = (...titles: string[]): string[] =>
    imports
      .enqueue(
        titles.map(title => ({
          url: `https://example.com/${title}`,
          title,
          artist: 'Aurora Lane',
          album: '',
          thumbnail: null,
          duration: 0,
        })),
        [],
        null,
      )
      .map(job => job.id)

  describe('claimNext', () => {
    it('passes over a job waiting to retry, and takes it once it is not', () => {
      const [first = '', second = ''] = enqueue('Sunrise', 'Moonrise')

      expect(imports.claimNext([first])?.id).toBe(second)
      expect(imports.claimNext([first])).toBeNull()
      expect(imports.claimNext()?.id).toBe(first)
    })
  })

  describe('cancel', () => {
    it('calls off a job that is queued, resolving or downloading', () => {
      const [queued = '', resolving = '', downloading = ''] = enqueue('One', 'Two', 'Three')
      imports.claimNext([queued, downloading])
      imports.claimNext([queued])
      imports.update(downloading, { step: 'downloading' })

      for (const id of [queued, resolving, downloading]) {
        expect(imports.cancel(id)).toBe(true)
        expect(imports.byId(id)?.status).toBe('cancelled')
      }
    })

    it('refuses once the song is on its way into the library', () => {
      const [id = ''] = enqueue('Sunrise')
      imports.claimNext()
      imports.update(id, { step: 'saving' })

      expect(imports.cancel(id)).toBe(false)
      expect(imports.byId(id)?.status).toBe('running')
    })
  })
})
