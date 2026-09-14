import { describe, expect, it } from 'vitest'

import { progressGate } from './files.js'

describe('progressGate', () => {
  it('lets the first report through, then one per interval', () => {
    let now = 0
    const gate = progressGate(250, () => now)
    expect(gate.due()).toBe(true)
    expect(gate.owed()).toBe(false)

    now = 10
    expect(gate.due()).toBe(false)
    now = 249
    expect(gate.due()).toBe(false)
    now = 250
    expect(gate.due()).toBe(true)
  })

  it('knows when the bytes since the last report were never sent, so the final one is', () => {
    let now = 0
    const gate = progressGate(250, () => now)
    gate.due()
    now = 100
    gate.due()
    expect(gate.owed()).toBe(true)

    now = 400
    gate.due()
    // Just sent: a final report would repeat it.
    expect(gate.owed()).toBe(false)
  })
})
