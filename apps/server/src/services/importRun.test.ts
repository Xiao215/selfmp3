import { describe, expect, it } from 'vitest'
import { importRun } from './importRun.js'

/** Finishes `seconds` apart from nine o'clock, as the server stamps them. */
const at = (...seconds: number[]): string[] =>
  seconds.map(s => {
    const d = new Date(Date.UTC(2026, 9, 1, 9, 0, s))
    return d.toISOString().slice(0, 19).replace('T', ' ')
  })

/** A bucket with a turn for every waiting song, one download at a time. */
const free = { turnsMs: 0, concurrency: 1 }

describe('the queue’s progress', () => {
  it('is nothing with no run open', () => {
    expect(importRun(null, free)).toBeNull()
  })

  it('counts the run’s finished songs among all of it', () => {
    expect(importRun({ open: 52, moving: 52, finishes: at(0, 48, 96) }, free)).toMatchObject({
      done: 3,
      total: 55,
    })
  })

  it('reads the time left from the run’s own pace once it has one', () => {
    // A song every 48 seconds, and 10 to go: eight minutes.
    expect(importRun({ open: 10, moving: 10, finishes: at(0, 48, 96, 144) }, free)?.leftMs).toBe(
      480_000,
    )
  })

  it('leaves a pause out of the pace', () => {
    // Twenty minutes paused between the second and third finish.
    const finishes = at(0, 30, 1_230, 1_260)
    expect(importRun({ open: 2, moving: 2, finishes }, free)?.leftMs).toBe(60_000)
  })

  it('takes a song’s length, side by side, before the run has a pace', () => {
    // Ten seconds a song, three at once: 26 songs is under a minute and a half.
    const run = importRun({ open: 26, moving: 26, finishes: [] }, { turnsMs: 0, concurrency: 3 })
    expect(run?.leftMs).toBe(86_667)
  })

  it('does not charge the songs the bucket has turns for a whole pacing interval each', () => {
    // A 26-song album on the lowest budget, one turn every 384 seconds, with a
    // full bucket: it once read "about 2 h 46 min left" and then minutes.
    const run = importRun({ open: 26, moving: 26, finishes: [] }, { turnsMs: 0, concurrency: 2 })
    expect(run?.leftMs).toBe(130_000)
  })

  it('waits for the turns the bucket does not have yet', () => {
    // Ten minutes until the last waiting song's turn, and then that song.
    const pace = { turnsMs: 600_000, concurrency: 2 }
    expect(importRun({ open: 5, moving: 5, finishes: [] }, pace)?.leftMs).toBe(610_000)
  })

  it('keeps waiting for turns once a burst has given the run a quick pace', () => {
    // Songs came in every ten seconds while the bucket lasted, but the rest
    // still waits an hour for its turns.
    const pace = { turnsMs: 3_600_000, concurrency: 2 }
    const run = importRun({ open: 40, moving: 40, finishes: at(0, 10, 20, 30) }, pace)
    expect(run?.leftMs).toBe(3_610_000)
  })

  it('says no time left while everything is paused', () => {
    expect(importRun({ open: 4, moving: 0, finishes: at(0, 10) }, free)).toEqual({
      done: 2,
      total: 6,
      leftMs: null,
    })
  })
})
