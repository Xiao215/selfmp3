import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MOTION_VERSION, MotionSchema } from '@selfmp3/shared'
import { createLogger } from '../logger.js'
import { MOTION_SAMPLE_RATE, motionFromPcm } from './dsp.js'
import { MotionStore, motionJson } from './motionStore.js'

/**
 * The file the route sends and the bucket keeps: valid against the shared
 * schema, as many frames as its duration says, and gone when it should be.
 */

describe('MotionStore', () => {
  let dataDir: string
  let store: MotionStore

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-motion-'))
    store = new MotionStore({ dataDir }, createLogger('silent'))
  })

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('writes a curve a client can read back whole, with as many frames as its duration says', async () => {
    // 106.5003 s: a length whose duration rounded to the millisecond loses a frame.
    const samples = Math.round(106.5003 * MOTION_SAMPLE_RATE) + 3
    const curve = motionFromPcm(new Float32Array(samples).fill(0.1), MOTION_SAMPLE_RATE)
    await store.write(7, curve)

    const stored = await store.read(7)
    expect(stored).not.toBeNull()
    const motion = MotionSchema.parse(JSON.parse(stored?.json ?? 'null'))
    expect(motion.version).toBe(MOTION_VERSION)
    const frames = Buffer.from(motion.loudness, 'base64').length
    expect(frames).toBe(curve.loudness.length)
    expect(Buffer.from(motion.onset, 'base64').length).toBe(frames)
    expect(Math.ceil(motion.duration * motion.rate)).toBe(frames)
    expect(await store.stat(7)).toMatchObject({ size: stored?.size })
  })

  it('leaves no temporary file behind, and forgets a deleted curve', async () => {
    await store.write(3, motionFromPcm(new Float32Array(MOTION_SAMPLE_RATE), MOTION_SAMPLE_RATE))
    expect(fs.readdirSync(path.join(dataDir, 'motion'))).toEqual(['3.json'])

    await store.delete(3)
    expect(await store.read(3)).toBeNull()
    expect(await store.bytes(3)).toBeNull()
    expect(await store.stat(3)).toBeNull()
    // Deleting what is not there is not an error.
    await store.delete(3)
  })

  it('encodes the bytes as they are', () => {
    const motion = motionJson({
      rate: 20,
      duration: 0.15,
      loudness: Uint8Array.from([0, 128, 255]),
      onset: Uint8Array.from([255, 1, 0]),
    })
    expect(motion).toEqual({
      version: MOTION_VERSION,
      rate: 20,
      duration: 0.15,
      loudness: 'AID/',
      onset: '/wEA',
    })
  })
})
