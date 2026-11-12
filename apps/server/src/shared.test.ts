import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from './logger.js'
import { FileThrottleStore } from './shared.js'
import { freshState } from './services/ytThrottle.js'

describe('YouTube’s pace in a file', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-pace-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads back what it saved, after a restart', () => {
    const state = { tokens: 2.5, ratchet: 0.5, updatedAt: 10, pausedUntil: 20, limitedAt: 5 }
    new FileThrottleStore(dir, createLogger('silent')).save(state)
    expect(new FileThrottleStore(dir, createLogger('silent')).get(99)).toEqual(state)
  })

  it('starts afresh from a file that is missing, not JSON, or not this shape', () => {
    const file = path.join(dir, 'yt-throttle.json')
    expect(new FileThrottleStore(dir, createLogger('silent')).get(7)).toEqual(freshState(7))
    fs.writeFileSync(file, '{ cut sho')
    expect(new FileThrottleStore(dir, createLogger('silent')).get(7)).toEqual(freshState(7))
    fs.writeFileSync(file, JSON.stringify({ tokens: 1, ratchet: '1' }))
    expect(new FileThrottleStore(dir, createLogger('silent')).get(7)).toEqual(freshState(7))
  })
})
