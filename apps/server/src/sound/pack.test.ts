import { describe, expect, it } from 'vitest'
import { decodePack, encodePack } from './pack.js'
import { SOUND_DIMENSIONS, toBlob } from './vectors.js'

const audio = (n: number): string => `audio/${String(n).repeat(64).slice(0, 64)}.m4a`

/** A vector's database bytes, pointing along one axis. */
function along(axis: number): Buffer {
  const v = new Float32Array(SOUND_DIMENSIONS)
  v[axis] = 0.5
  v[axis + 1] = -0.25
  return toBlob(v)
}

describe('the sound vectors file', () => {
  it('gives back exactly the bytes it was given, and the songs that could not be heard', () => {
    const entries = [
      { audioKey: audio(2), vector: along(4) },
      { audioKey: audio(1), vector: along(9) },
      { audioKey: audio(3), vector: null },
    ]
    const pack = decodePack(encodePack('clamp3-test', entries))
    expect(pack?.model).toBe('clamp3-test')
    // Sorted by audio key, the unhearable ones after.
    expect(pack?.entries).toEqual([
      { audioKey: audio(1), vector: along(9) },
      { audioKey: audio(2), vector: along(4) },
      { audioKey: audio(3), vector: null },
    ])
  })

  it('makes the same file from the same vectors, whatever order they come in', () => {
    const a = { audioKey: audio(1), vector: along(1) }
    const b = { audioKey: audio(2), vector: along(2) }
    expect(encodePack('m', [a, b]).equals(encodePack('m', [b, a]))).toBe(true)
  })

  it('names two songs with the same audio once', () => {
    const pack = decodePack(
      encodePack('m', [
        { audioKey: audio(1), vector: along(1) },
        { audioKey: audio(1), vector: along(1) },
      ]),
    )
    expect(pack?.entries).toHaveLength(1)
  })

  it('reads nothing from a file that is cut short or not one at all', () => {
    const whole = encodePack('m', [{ audioKey: audio(1), vector: along(1) }])
    expect(decodePack(whole.subarray(0, whole.length - 4))).toBeNull()
    expect(decodePack(Buffer.from('{"not":"a pack"}'))).toBeNull()
    expect(decodePack(Buffer.alloc(2))).toBeNull()
  })
})
