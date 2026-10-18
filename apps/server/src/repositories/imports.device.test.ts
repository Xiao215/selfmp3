import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { ImportRepository } from './imports.js'

/**
 * Jobs a device downloads (docs/features/client-download.md), against a real
 * SQLite: the server leaves a held job alone, and gets it back whenever the
 * device lets it go or stops renewing its lease.
 *
 * A lease of zero seconds is one that has already run out: SQLite tells time
 * to the second, and a lease is held only while its end is still ahead.
 */
describe('ImportRepository, jobs a device holds', () => {
  let db: Database.Database
  let imports: ImportRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    imports = new ImportRepository(db)
  })

  const item = (url: string) => ({
    url,
    title: url.slice(-1),
    artist: 'Aurora Lane',
    album: '',
    thumbnail: null,
    duration: 180,
  })

  /** A YouTube song held for a device, and a 网易云 one the server keeps. */
  function enqueueForDevice(seconds = 300): { held: string; server: string } {
    const [held, server] = imports.enqueue(
      [
        item('https://www.youtube.com/watch?v=aaaaaaaaaaa'),
        item('https://music.163.com/song?id=1'),
      ],
      [],
      null,
      {
        lease: 'lease-1',
        seconds,
        fetcherFor: entry => (entry.url.includes('youtube') ? 'device' : 'server'),
      },
    )
    return { held: held!.id, server: server!.id }
  }

  it('leaves a held job to the device, and takes the rest', () => {
    const { held, server } = enqueueForDevice()
    expect(imports.fetcherOf(held)).toEqual({ fetcher: 'device', lease: 'lease-1' })
    expect(imports.fetcherOf(server)).toEqual({ fetcher: 'server', lease: null })
    expect(imports.claimNext()?.id).toBe(server)
    expect(imports.claimNext()).toBeNull()
  })

  it('takes a job whose lease ran out, as the server’s', () => {
    const { held } = enqueueForDevice(0)
    const claimed = imports.claimNext()
    expect(claimed?.id).toBe(held)
    expect(imports.fetcherOf(held)).toEqual({ fetcher: 'server', lease: null })
  })

  it('names what the lease holds, and follows a download’s progress', () => {
    const { held } = enqueueForDevice()
    expect(imports.renewLease('lease-1', 300, [])).toEqual([held])
    expect(imports.renewLease('another', 300, [])).toEqual([])

    expect(imports.startOnDevice('lease-1', held, 300)).toBe(true)
    expect(imports.byId(held)).toMatchObject({
      status: 'running',
      step: 'downloading',
      attempts: 1,
    })
    // Started again after waiting out a refusal for rate: one more attempt, still the device's.
    expect(imports.startOnDevice('lease-1', held, 300)).toBe(true)
    expect(imports.byId(held)?.attempts).toBe(2)

    expect(imports.renewLease('lease-1', 300, [{ id: held, percent: 42.7 }])).toEqual([held])
    expect(imports.byId(held)?.progress).toBe(42)
  })

  it('drops a cancelled job from what the lease holds', () => {
    const { held } = enqueueForDevice()
    imports.startOnDevice('lease-1', held, 300)
    expect(imports.cancel(held)).toBe(true)
    expect(imports.renewLease('lease-1', 300, [])).toEqual([])
    expect(imports.takeFromDevice('lease-1', held)).toBeNull()
  })

  it('gives a job the device let go to the server, for good', () => {
    const { held, server } = enqueueForDevice()
    imports.claimNext() // the server's own song
    imports.startOnDevice('lease-1', held, 300)
    expect(imports.releaseFromDevice('another', held)).toBe(false)
    expect(imports.releaseFromDevice('lease-1', held)).toBe(true)

    expect(imports.byId(held)).toMatchObject({ status: 'queued', step: 'waiting' })
    expect(imports.fetcherOf(held)).toEqual({ fetcher: 'server', lease: null })
    expect(imports.claimNext()?.id).toBe(held)
    expect(server).not.toBe(held)
  })

  it('hands the job over once its file has come, and only to the lease that holds it', () => {
    const { held } = enqueueForDevice()
    imports.startOnDevice('lease-1', held, 300)
    expect(imports.takeFromDevice('another', held)).toBeNull()

    const taken = imports.takeFromDevice('lease-1', held)
    expect(taken).toMatchObject({ id: held, status: 'running', step: 'converting', attempts: 1 })
    expect(imports.fetcherOf(held)).toEqual({ fetcher: 'device', lease: null })
    // Nothing more for the device to do with it.
    expect(imports.renewLease('lease-1', 300, [])).toEqual([])
  })

  it('counts an attempt for a file that came without a start', () => {
    const { held } = enqueueForDevice()
    expect(imports.takeFromDevice('lease-1', held)?.attempts).toBe(1)
  })

  it('puts back a download the device stopped answering for', () => {
    const { held } = enqueueForDevice()
    imports.startOnDevice('lease-1', held, 0)
    expect(imports.expireLeases()).toBe(1)
    expect(imports.byId(held)).toMatchObject({ status: 'queued', step: 'waiting', progress: null })
    expect(imports.fetcherOf(held)).toEqual({ fetcher: 'server', lease: null })
  })

  it('does not renew a lease that has run out', () => {
    const { held } = enqueueForDevice(0)
    expect(imports.renewLease('lease-1', 300, [])).toEqual([])
    expect(imports.startOnDevice('lease-1', held, 300)).toBe(false)
    expect(imports.takeFromDevice('lease-1', held)).toBeNull()
  })

  it('leaves a device’s download alone when the server restarts', () => {
    const { held, server } = enqueueForDevice()
    imports.claimNext()
    imports.startOnDevice('lease-1', held, 300)
    expect(imports.resetOrphaned()).toBe(1)
    expect(imports.byId(server)?.status).toBe('queued')
    expect(imports.byId(held)).toMatchObject({ status: 'running', step: 'downloading' })
  })

  it('says when the soonest lease runs out', () => {
    expect(imports.nextLeaseEnd()).toBeNull()
    enqueueForDevice(300)
    const end = imports.nextLeaseEnd()
    expect(end).not.toBeNull()
    expect(Math.abs((end ?? 0) - (Date.now() + 300_000))).toBeLessThan(5_000)
  })
})
