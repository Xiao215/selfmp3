import { describe, expect, it } from 'vitest'
import {
  SOUND_DIMENSIONS,
  decodeSoundPack,
  nearestFirst,
  packedVector,
  packVector,
  soundCentre,
  soundCloseness,
  unpackVector,
} from './soundVectors.js'

/**
 * How songs sound, read on a device: the server's pack, and the small packed
 * vectors a listening room carries.
 */

function unit(seed: number): Float32Array {
  const vector = new Float32Array(SOUND_DIMENSIONS)
  for (let index = 0; index < SOUND_DIMENSIONS; index++)
    vector[index] = Math.sin(seed * (index + 1))
  const length = Math.hypot(...vector)
  return vector.map(value => value / length)
}

function pack(model: string, entries: Array<[string, Float32Array]>): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      model,
      dimensions: SOUND_DIMENSIONS,
      heard: entries.map(e => e[0]),
      unhearable: [],
    }),
  )
  const bytes = new Uint8Array(4 + header.length + entries.length * SOUND_DIMENSIONS * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, header.length, true)
  bytes.set(header, 4)
  entries.forEach(([, vector], at) => {
    vector.forEach((value, dimension) =>
      view.setFloat32(4 + header.length + (at * SOUND_DIMENSIONS + dimension) * 4, value, true),
    )
  })
  return bytes
}

describe('a sound pack', () => {
  it('gives each heard song’s vector by its audio key', () => {
    const decoded = decodeSoundPack(
      pack('clamp3-saas-1', [
        ['audio/a.m4a', unit(1)],
        ['audio/b.m4a', unit(2)],
      ]),
    )
    expect(decoded?.model).toBe('clamp3-saas-1')
    expect(decoded?.vectors.get('audio/b.m4a')?.[5]).toBeCloseTo(unit(2)[5] ?? 0, 6)
  })

  it('reads nothing from a pack that is cut short or of other dimensions', () => {
    const whole = pack('m', [['audio/a.m4a', unit(1)]])
    expect(decodeSoundPack(whole.slice(0, whole.length - 4))).toBeNull()
    expect(decodeSoundPack(new Uint8Array([1, 0]))).toBeNull()
  })
})

describe('a packed vector', () => {
  it('comes back as it went, to a byte, at about a kilobyte', () => {
    const text = packVector(unit(3))
    expect(text.length).toBe(1024)
    const back = unpackVector(text)
    expect(back?.length).toBe(SOUND_DIMENSIONS)
    expect(back?.[7]).toBe(Math.round((unit(3)[7] ?? 0) * 127))
    expect(unpackVector('not base64!')).toBeNull()
    expect(unpackVector(packVector([0.5, 0.5]))).toBeNull()
  })

  it('ranks songs as the full vectors do', () => {
    const [a, b, c] = [unit(1), unit(1.01), unit(7)].map(vector => unpackVector(packVector(vector)))
    if (!a || !b || !c) throw new Error('unpacked nothing')
    expect(soundCloseness(a, a)).toBeCloseTo(1, 1)
    expect(soundCloseness(a, b)).toBeGreaterThan(soundCloseness(a, c))
    const centre = soundCentre([a, b])
    if (!centre) throw new Error('no centre')
    expect(soundCloseness(centre, a)).toBeGreaterThan(soundCloseness(centre, c))
    expect(soundCentre([])).toBeNull()
  })
})

describe('nearestFirst', () => {
  it('puts those nearest first, and those with no closeness after them', () => {
    const near: Record<string, number | null> = { a: 0.2, b: null, c: 0.9, d: null, e: 0.5 }
    const order = nearestFirst(
      ['a', 'b', 'c', 'd', 'e'],
      item => near[item] ?? null,
      () => 0.5,
    )
    expect(order.slice(0, 3)).toEqual(['c', 'e', 'a'])
    expect(new Set(order.slice(3))).toEqual(new Set(['b', 'd']))
  })
})

describe('packedVector', () => {
  it('holds a vector as the packed text does', () => {
    const vector = Array.from({ length: SOUND_DIMENSIONS }, (_, at) => Math.sin(at) / 20)
    expect([...packedVector(vector)]).toEqual([...unpackVector(packVector(vector))!])
  })
})
