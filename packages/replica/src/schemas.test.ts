import { describe, expect, it } from 'vitest'
import { isPendingRequest } from './schemas.js'

describe('isPendingRequest', () => {
  it('is a request the server has not finished with', () => {
    expect(isPendingRequest({ state: 'waiting' })).toBe(true)
    expect(isPendingRequest({ state: 'working' })).toBe(true)
    expect(isPendingRequest({ state: 'done' })).toBe(false)
    expect(isPendingRequest({ state: 'cancelled' })).toBe(false)
  })
})
