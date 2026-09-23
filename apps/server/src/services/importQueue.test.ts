import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { ImportRepository } from '../repositories/imports.js'
import { SettingsRepository } from '../repositories/settings.js'
import { ThrottleRepository } from '../repositories/throttle.js'
import { ImportQueueService } from './importQueue.js'
import { YtDlpService } from './ytdlp.js'
import { YtThrottleService } from './ytThrottle.js'

/**
 * What the worker does with a download that did not work.
 *
 * Two answers, and telling them apart is the whole point: a song that cannot
 * be downloaded is a failure a person should see and decide about, while
 * YouTube refusing the address for rate says nothing about the song and must
 * not consume it. Everything below drives the real queue and the real
 * YtDlpService against a real SQLite. The one thing stood in for is the
 * `yt-dlp` binary itself, by a script on PATH that fails with whatever a test
 * tells it to say.
 *
 * That is deliberate. An earlier version of this file replaced `download` with
 * a function that threw yt-dlp's raw words, and passed — while in the server
 * those words are rewritten for people before the queue ever sees them, and
 * the queue, looking for "not a bot" in a sentence that no longer said it,
 * failed every rate-limited job. Nothing between the binary and the database
 * is faked here so that cannot happen quietly again.
 */

/**
 * Waits until `done` holds: the worker runs a real child process, so not at once.
 *
 * Bounded by the clock rather than by a count of turns. Counting turns reads as
 * ten milliseconds each and is not: `setTimeout` promises a floor, not a delay,
 * and with the rest of the suite on the other cores each turn stretches. Four
 * hundred of them were budgeted at four seconds against vitest's five, which
 * left these timing out on a busy machine — as "test timed out", the one
 * message that says nothing about what was being waited for.
 *
 * The budget is deliberately far longer than the work: these tests spawn real
 * child processes, and the whole of them takes 0.3s to 1.9s on a quiet machine
 * but stretches several times over with the rest of the suite on the other
 * cores. It is here to end a wait that is never going to finish, and to say so,
 * rather than to police how long a loaded machine may take.
 *
 * Ten seconds was still policing. A runner with two cores and two hundred
 * other test files in flight took longer than that to spawn one of these
 * children, and the budget failed a rate-limit test that had passed on every
 * other push (Pages run 35821594984, 2026-09-23). Thirty is past anything a
 * loaded machine has shown, and a wait that is truly stuck still ends here
 * with a sentence about what it was waiting for rather than at vitest's own
 * timeout, which says nothing.
 */
async function until(done: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  if (!done()) throw new Error(`until: still false after ${timeoutMs}ms`)
  // A turn more, for the bookkeeping that follows whatever `done` was watching.
  await new Promise(resolve => setTimeout(resolve, 20))
}

// Room for the two longest waits in one test, and the child processes between
// them, so `until`'s message is what a stuck test reports.
describe('ImportQueueService, when a download fails', { timeout: 90_000 }, () => {
  let imports: ImportRepository
  let throttle: YtThrottleService
  let queue: ImportQueueService
  let db: Database.Database
  let now: number
  let dir: string
  let savedPath: string | undefined

  /** What the stand-in `yt-dlp` will print to stderr before exiting 1. */
  function ytDlpFailsWith(message: string): void {
    fs.writeFileSync(path.join(dir, 'stderr.txt'), `ERROR: [youtube] 6I1SNW0tVYk: ${message}\n`)
  }

  /** Make the stand-in hang instead, as a download does until it is killed. */
  function ytDlpHangs(): void {
    fs.writeFileSync(path.join(dir, 'hang'), '')
  }

  /** How many times the stand-in was asked to download something. */
  function downloads(): number {
    const log = path.join(dir, 'calls.log')
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0
  }

  beforeEach(() => {
    now = 1_700_000_000_000
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-queue-'))

    // `--version` answers like the real thing so the tool check passes; any
    // other call is a download, which is logged and then fails as instructed.
    const bin = path.join(dir, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, 'yt-dlp'),
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo 2026.08.19; exit 0; fi
echo call >> "${dir}/calls.log"
if [ -f "${dir}/hang" ]; then exec sleep 60; fi
cat "${dir}/stderr.txt" >&2
exit 1
`,
      { mode: 0o755 },
    )
    savedPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`

    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    imports = new ImportRepository(db)
    const settings = new SettingsRepository(db)
    throttle = new YtThrottleService(
      new ThrottleRepository(db),
      () => false,
      () => now,
    )

    /** Stands in for a step no test here reaches; reaching one is the bug. */
    const nothing = (): never => {
      throw new Error('the test should not have got this far')
    }

    queue = new ImportQueueService({
      config: { dataDir: dir },
      storage: { write: nothing, exists: async () => false },
      imports,
      songs: { byId: () => null, patch: nothing, setSourceUrl: nothing, setInstrumental: nothing },
      tags: { exists: () => [], addToSong: nothing },
      playlists: { byId: () => null, add: nothing },
      settings,
      scanner: { ingest: nothing },
      lyrics: { fetchRemote: async () => null, writeSidecar: nothing },
      covers: { saveFromUrl: nothing },
      ytdlp: new YtDlpService(createLogger('silent'), () => settings.get(), throttle),
      cloud: { connected: false, uploadSong: nothing, kick: () => undefined },
      keepAwake: { hold: () => () => undefined },
      throttle,
      logger: createLogger('silent'),
    })
  })

  afterEach(() => {
    queue.stop()
    process.env.PATH = savedPath
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** One job, already named so the worker does not have to probe for a title. */
  function enqueueOne(): string {
    const [job] = imports.enqueue(
      [
        {
          url: 'https://www.youtube.com/watch?v=6I1SNW0tVYk',
          title: 'Where Mercy Endures',
          artist: 'HOYO-MiX',
          album: '',
          thumbnail: null,
          duration: 0,
        },
      ],
      [],
      null,
    )
    if (!job) throw new Error('nothing was queued')
    return job.id
  }

  it('puts a job back in the queue when the server stops under it', async () => {
    ytDlpHangs()
    const id = enqueueOne()

    queue.kick()
    await until(() => imports.byId(id)?.status === 'running')
    queue.stop()
    await until(() => imports.byId(id)?.status !== 'running')
    // Nobody cancelled it: the next boot's `resetOrphaned` finds it waiting.
    expect(imports.byId(id)).toMatchObject({ status: 'queued', step: 'waiting', error: null })
  })

  it('marks a job cancelled when a person cancels it mid-download', async () => {
    ytDlpHangs()
    const id = enqueueOne()

    queue.kick()
    await until(() => imports.byId(id)?.status === 'running')
    expect(queue.cancel(id)).toBe(true)
    await until(() => imports.byId(id)?.status !== 'running')
    expect(imports.byId(id)).toMatchObject({ status: 'cancelled', step: 'finished' })
  })

  it('leaves a broken song failed, and does not try it again', async () => {
    ytDlpFailsWith('Private video. Sign in if you have been granted access to this video')
    const id = enqueueOne()

    queue.kick()
    await until(() => imports.byId(id)?.status === 'error')

    const job = imports.byId(id)
    expect(job?.status).toBe('error')
    expect(job?.error).toBeTruthy()
    // Tried once. A second attempt would mean the queue retried by itself.
    expect(downloads()).toBe(1)
    expect(job?.attempts).toBe(1)
    // A broken song is not the network's fault, and must not cost the budget.
    expect(throttle.status().ratchet).toBe(1)
  })

  it('puts a rate-limited song back in the queue instead of failing it', async () => {
    ytDlpFailsWith('Sign in to confirm you’re not a bot. Use --cookies-from-browser')
    const id = enqueueOne()

    queue.kick()
    await until(() => downloads() >= 1 && imports.byId(id)?.status === 'queued')

    const job = imports.byId(id)
    // Nothing is wrong with this song, so nothing about it is marked wrong.
    expect(job?.status).toBe('queued')
    expect(job?.error).toBeNull()
  })

  it('stops the whole queue after a rate limit, rather than burning through it', async () => {
    ytDlpFailsWith('Unable to download webpage: HTTP Error 429: Too Many Requests')
    for (let i = 0; i < 5; i++) enqueueOne()

    queue.kick()
    await until(() => throttle.status().pausedUntil !== null && imports.counts().running === 0)

    // The songs already in flight when the answer came back cannot be
    // un-asked, so the ceiling is the concurrency limit and not one — but the
    // queue stops there rather than working through all five.
    const limit = new SettingsRepository(db).get().importConcurrency
    expect(downloads()).toBeGreaterThanOrEqual(1)
    expect(downloads()).toBeLessThanOrEqual(limit)
    // Nothing was consumed: every song is still waiting to be tried.
    expect(imports.counts().queued).toBe(5)
  })

  it('starts again by itself once the pause is over', async () => {
    ytDlpFailsWith('Sign in to confirm you’re not a bot')
    const id = enqueueOne()
    queue.kick()
    await until(() => downloads() === 1 && imports.byId(id)?.status === 'queued')

    // Still paused a minute later: asking changes nothing.
    now += 60_000
    queue.kick()
    await new Promise(resolve => setTimeout(resolve, 600)) // long enough to have spawned
    expect(downloads()).toBe(1)

    // Past the pause it picks the job up again, with no one having clicked.
    ytDlpFailsWith('Video unavailable')
    now += 20 * 60_000
    queue.kick()
    await until(() => imports.byId(id)?.status === 'error')
    expect(downloads()).toBe(2)
    expect(imports.byId(id)?.status).toBe('error')
  })

  it('halves the budget for a rate limit, once, and does not restore it on its own', async () => {
    const before = throttle.status().budgetPerHour
    ytDlpFailsWith('Sign in to confirm you’re not a bot')
    // Two at once, so two refusals land together: one incident, one cut.
    enqueueOne()
    enqueueOne()
    queue.kick()
    await until(() => throttle.status().pausedUntil !== null && imports.counts().running === 0)

    expect(throttle.status().budgetPerHour).toBe(before / 2)
    now += 24 * 60 * 60_000
    expect(throttle.status().budgetPerHour).toBe(before / 2)
  })
})
