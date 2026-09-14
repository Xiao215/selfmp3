import { describe, expect, it } from 'vitest'

import { runLimited } from './limited.js'

/** A promise and the means to settle it from outside. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
}

describe('runLimited', () => {
  it('never runs more than the limit at once, and runs everything', async () => {
    const gates = Array.from({ length: 10 }, deferred)
    let running = 0
    let most = 0
    const started: number[] = []
    const pass = runLimited(
      gates.map((_, index) => index),
      4,
      async index => {
        started.push(index)
        running += 1
        most = Math.max(most, running)
        await gates[index]!.promise
        running -= 1
      },
    )
    await settle()
    expect(started).toEqual([0, 1, 2, 3])
    for (const gate of gates) {
      gate.resolve()
      await settle()
    }
    await expect(pass).resolves.toBe(true)
    expect(most).toBe(4)
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('stops starting items once called off, and says so', async () => {
    const gates = Array.from({ length: 10 }, deferred)
    const started: number[] = []
    let cancelled = false
    const pass = runLimited(
      gates.map((_, index) => index),
      2,
      async index => {
        started.push(index)
        await gates[index]!.promise
      },
      () => cancelled,
    )
    await settle()
    cancelled = true
    gates[0]!.resolve()
    gates[1]!.resolve()
    await expect(pass).resolves.toBe(false)
    expect(started).toEqual([0, 1])
  })

  it('carries on past an item that fails', async () => {
    const done: number[] = []
    const finished = await runLimited([1, 2, 3], 2, index => {
      if (index === 2) return Promise.reject(new Error('the Mac went away'))
      done.push(index)
      return Promise.resolve()
    })
    expect(finished).toBe(true)
    expect(done).toEqual([1, 3])
  })

  it('finishes at once with nothing to do', async () => {
    await expect(runLimited([], 4, () => Promise.resolve())).resolves.toBe(true)
  })
})
