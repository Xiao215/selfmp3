import { describe, expect, it } from 'vitest'
import { pool } from './pool.js'

describe('pool', () => {
  it('answers in the items’ order, however the work finishes', async () => {
    const delays = [30, 5, 20, 0, 10]
    const answers = await pool(delays, 2, async ms => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return ms * 2
    })
    expect(answers).toEqual([60, 10, 40, 0, 20])
  })

  it('runs no more than its width at once', async () => {
    let running = 0
    let most = 0
    await pool(
      Array.from({ length: 10 }, (_, at) => at),
      3,
      async () => {
        running++
        most = Math.max(most, running)
        await new Promise(resolve => setTimeout(resolve, 1))
        running--
      },
    )
    expect(most).toBe(3)
  })

  it('starts nothing new once an item throws', async () => {
    const started: number[] = []
    const run = pool([0, 1, 2, 3, 4, 5], 2, async at => {
      started.push(at)
      await new Promise(resolve => setTimeout(resolve, 1))
      if (at === 0) throw new Error('no')
    })
    await expect(run).rejects.toThrow('no')
    expect(started).toEqual([0, 1])
  })

  it('answers nothing for no items', async () => {
    expect(await pool([], 4, () => Promise.resolve(1))).toEqual([])
  })
})
