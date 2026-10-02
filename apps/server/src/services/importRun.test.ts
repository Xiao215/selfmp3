import { describe, expect, it } from 'vitest'
import { importRun } from './importRun.js'

/** Finishes `seconds` apart from nine o'clock, as the server stamps them. */
const at = (...seconds: number[]): string[] =>
  seconds.map(s => {
    const d = new Date(Date.UTC(2026, 9, 1, 9, 0, s))
    return d.toISOString().slice(0, 19).replace('T', ' ')
  })

describe('the queue’s progress', () => {
  it('is nothing with no run open', () => {
    expect(importRun(null, 75)).toBeNull()
  })

  it('counts the run’s finished songs among all of it', () => {
    expect(importRun({ open: 52, moving: 52, finishes: at(0, 48, 96) }, 75)).toMatchObject({
      done: 3,
      total: 55,
    })
  })

  it('reads the time left from the run’s own pace once it has one', () => {
    // A song every 48 seconds, and 10 to go: eight minutes.
    expect(importRun({ open: 10, moving: 10, finishes: at(0, 48, 96, 144) }, 1_000)?.leftMs).toBe(
      480_000,
    )
  })

  it('leaves a pause out of the pace', () => {
    // Twenty minutes paused between the second and third finish.
    const finishes = at(0, 30, 1_230, 1_260)
    expect(importRun({ open: 2, moving: 2, finishes }, 75)?.leftMs).toBe(60_000)
  })

  it('goes by the pacing before the run has a pace, and never faster than a song takes', () => {
    // 75 an hour: one every 48 seconds.
    expect(importRun({ open: 5, moving: 5, finishes: [] }, 75)?.leftMs).toBe(240_000)
    // 1000 an hour would be 3.6 seconds, but a song takes about ten.
    expect(importRun({ open: 5, moving: 5, finishes: at(0) }, 1_000)?.leftMs).toBe(50_000)
  })

  it('says no time left while everything is paused', () => {
    expect(importRun({ open: 4, moving: 0, finishes: at(0, 10) }, 75)).toEqual({
      done: 2,
      total: 6,
      leftMs: null,
    })
  })
})
