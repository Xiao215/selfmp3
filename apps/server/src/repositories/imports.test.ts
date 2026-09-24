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
    it('takes jobs in the order they were asked for, and none twice', () => {
      const [first = '', second = ''] = enqueue('Sunrise', 'Moonrise')

      expect(imports.claimNext()?.id).toBe(first)
      expect(imports.claimNext()?.id).toBe(second)
      expect(imports.claimNext()).toBeNull()
    })
  })

  describe('recent', () => {
    it('lists what failed before what waits, so a long queue cannot hide it', () => {
      const [failed = '', running = ''] = enqueue('Failed', 'Running', 'Waiting')
      const [paused = '', done = ''] = enqueue('Paused', 'Done')
      imports.claimNext()
      imports.claimNext()
      imports.update(failed, { status: 'error', step: 'uploading', error: 'the bucket is full' })
      imports.update(running, { step: 'downloading' })
      imports.update(paused, { status: 'cancelled', step: 'finished' })
      imports.update(done, { status: 'done', step: 'finished' })

      expect(imports.recent(100).map(job => job.title)).toEqual([
        'Running',
        'Failed',
        'Waiting',
        'Paused',
        'Done',
      ])
      // Cut off at the limit, the failure is still on the list.
      expect(imports.recent(2).map(job => job.title)).toEqual(['Running', 'Failed'])
    })
  })

  describe('clearFinished', () => {
    it('takes only the jobs that added their song, never a failed or paused one', () => {
      const [done = '', failed = '', paused = ''] = enqueue('Done', 'Failed', 'Paused', 'Waiting')
      imports.update(done, { status: 'done', step: 'finished' })
      imports.update(failed, { status: 'error', step: 'finished', error: 'Video unavailable' })
      imports.update(paused, { status: 'cancelled', step: 'finished' })

      expect(imports.clearFinished()).toBe(1)
      expect(imports.recent().map(job => job.title)).toEqual(['Failed', 'Waiting', 'Paused'])
    })
  })

  describe('dismiss', () => {
    it('drops a failed or paused job, and refuses one still going', () => {
      const [failed = '', paused = '', waiting = ''] = enqueue('Failed', 'Paused', 'Waiting')
      imports.update(failed, { status: 'error', step: 'finished', error: 'Video unavailable' })
      imports.update(paused, { status: 'cancelled', step: 'finished' })

      expect(imports.dismiss(failed)).toBe(true)
      expect(imports.dismiss(paused)).toBe(true)
      expect(imports.dismiss(waiting)).toBe(false)
      expect(imports.recent().map(job => job.title)).toEqual(['Waiting'])
    })
  })

  describe('cancel', () => {
    it('calls off a job that is queued, resolving or downloading', () => {
      const [resolving = '', downloading = '', queued = ''] = enqueue('One', 'Two', 'Three')
      imports.claimNext()
      imports.claimNext()
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

  describe('pause all and resume all', () => {
    it('calls off what a cancel would, and names the ones it took', () => {
      const [downloading = '', saving = '', queued = ''] = enqueue('One', 'Two', 'Three')
      imports.claimNext()
      imports.claimNext()
      imports.update(downloading, { step: 'downloading' })
      imports.update(saving, { step: 'saving' })

      expect(imports.cancelAll().sort()).toEqual([downloading, queued].sort())
      expect(imports.byId(downloading)?.status).toBe('cancelled')
      expect(imports.byId(queued)?.status).toBe('cancelled')
      expect(imports.byId(saving)?.status).toBe('running')
      expect(imports.cancelAll()).toEqual([])
    })

    it('queues what was paused again, in the order it was asked for, and leaves failures be', () => {
      const [first = '', failed = '', second = ''] = enqueue('One', 'Two', 'Three')
      imports.claimNext()
      imports.update(failed, { status: 'error', error: 'Video unavailable' })
      imports.cancelAll()

      expect(imports.retryCancelled()).toBe(2)
      expect(imports.claimNext()?.id).toBe(first)
      expect(imports.claimNext()?.id).toBe(second)
      expect(imports.byId(failed)?.status).toBe('error')
      expect(imports.retryCancelled()).toBe(0)
    })
  })
})
