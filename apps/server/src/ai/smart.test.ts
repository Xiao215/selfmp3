import { describe, expect, it } from 'vitest'
import { setupFor } from './smart.js'

function config(baseUrl: string | null) {
  return {
    ai: { baseUrl, apiKey: 'secret', modelFast: 'haiku', modelSmart: 'sonnet', timeoutSeconds: 30 },
  }
}

describe('setupFor', () => {
  it('shows the address without credentials or a query, and the two tiers', () => {
    expect(setupFor(config('https://me:pw@models.example.com/v1?key=abc'))).toEqual({
      address: 'https://models.example.com/v1',
      models: { fast: 'haiku', smart: 'sonnet' },
    })
  })

  it('says off with no address', () => {
    expect(setupFor(config(null)).address).toBeNull()
  })
})
