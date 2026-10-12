import { describe, expect, it } from 'vitest'
import { decodeSoundPack } from '@selfmp3/shared'
import { encodePack } from './pack.js'
import { SOUND_DIMENSIONS, toBlob, unit } from './vectors.js'

/** A pack this server writes is one a device can read (packages/shared's soundVectors.ts). */

describe('the sound pack, on a device', () => {
  it('reads every heard song’s vector the server wrote, and skips the unhearable', () => {
    const vector = unit(Array.from({ length: SOUND_DIMENSIONS }, (_, index) => Math.cos(index)))
    const data = encodePack('clamp3-saas-1', [
      { audioKey: `audio/${'b'.repeat(64)}.m4a`, vector: toBlob(vector) },
      { audioKey: `audio/${'a'.repeat(64)}.m4a`, vector: null },
    ])
    const read = decodeSoundPack(new Uint8Array(data))
    expect(read?.model).toBe('clamp3-saas-1')
    expect([...(read?.vectors.keys() ?? [])]).toEqual([`audio/${'b'.repeat(64)}.m4a`])
    expect(read?.vectors.get(`audio/${'b'.repeat(64)}.m4a`)?.[3]).toBeCloseTo(vector[3] ?? 0, 6)
  })
})
