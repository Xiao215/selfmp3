import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { readStored } from './stored.model'

const Schema = z.object({ hue: z.number(), size: z.number().default(1) })

describe('a stored value read back', () => {
  it('is what its schema reads, defaults filled in', () => {
    expect(readStored('{"hue":200}', Schema)).toEqual({ hue: 200, size: 1 })
  })

  it('is none when nothing was kept, it is not JSON, or it is another shape', () => {
    expect(readStored(null, Schema)).toBeNull()
    expect(readStored('', Schema)).toBeNull()
    expect(readStored('{"hue":', Schema)).toBeNull()
    expect(readStored('{"hue":"pink"}', Schema)).toBeNull()
  })
})
