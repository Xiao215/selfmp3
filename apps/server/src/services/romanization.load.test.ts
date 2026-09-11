import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.js'
import { RomanizationService } from './romanization.js'

/**
 * The real loading path, with the two packages replaced. It is the part that
 * broke: the class arrives wrapped differently under plain Node and under tsx,
 * and a dictionary that failed to load was cached as "no romaji".
 */

const engine = vi.hoisted(() => ({
  /** How the module arrives: plain Node's double default, or tsx's single one. */
  shape: 'node' as 'node' | 'tsx',
  failInit: false,
}))

vi.mock('kuroshiro', () => {
  class Kuroshiro {
    init(): Promise<void> {
      return engine.failInit ? Promise.reject(new Error('dictionary missing')) : Promise.resolve()
    }
    convert(text: string): Promise<string> {
      return Promise.resolve(`romaji(${text})`)
    }
  }
  return {
    get default() {
      return engine.shape === 'node' ? { default: Kuroshiro } : Kuroshiro
    },
  }
})

vi.mock('kuroshiro-analyzer-kuromoji', () => ({ default: class Analyzer {} }))

describe('RomanizationService loading kuroshiro', () => {
  beforeEach(() => {
    engine.shape = 'node'
    engine.failInit = false
  })

  it.each(['node', 'tsx'] as const)('loads the dictionary as %s hands it over', async shape => {
    engine.shape = shape
    const { lyrics, complete } = await new RomanizationService(createLogger('silent')).romanize(
      '桜の風が吹くとき',
    )
    expect(lyrics.lines[0]?.romanized).toBe('romaji(桜の風が吹くとき)')
    expect(complete).toBe(true)
  })

  it('says a result is incomplete when the dictionary fails to load, and tries again next time', async () => {
    const service = new RomanizationService(createLogger('silent'))
    engine.failInit = true
    const failed = await service.romanize('桜の風が吹くとき')
    expect(failed.complete).toBe(false)
    expect(failed.lyrics.lines[0]?.romanized).toBe('')

    engine.failInit = false
    const retried = await service.romanize('桜の風が吹くとき')
    expect(retried.complete).toBe(true)
    expect(retried.lyrics.lines[0]?.romanized).toBe('romaji(桜の風が吹くとき)')
  })
})
