import { describe, expect, it } from 'vitest'
import { Gate } from './gate.js'

describe('Gate', () => {
  it('lets no more than its size through at once, in the order they came', async () => {
    const gate = new Gate(2)
    let running = 0
    let most = 0
    const order: number[] = []
    const releases: (() => void)[] = []
    const runs = [1, 2, 3, 4].map(n =>
      gate.run(async () => {
        running++
        most = Math.max(most, running)
        order.push(n)
        await new Promise<void>(resolve => releases.push(resolve))
        running--
        return n
      }),
    )
    await Promise.resolve()
    expect(order).toEqual([1, 2])
    while (releases.length > 0) {
      releases.shift()?.()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(await Promise.all(runs)).toEqual([1, 2, 3, 4])
    expect(order).toEqual([1, 2, 3, 4])
    expect(most).toBe(2)
  })

  it('passes the turn on when the work throws', async () => {
    const gate = new Gate(1)
    await expect(gate.run(() => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(await gate.run(() => Promise.resolve('next'))).toBe('next')
  })
})
