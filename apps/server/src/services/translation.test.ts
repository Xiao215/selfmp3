import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createLogger } from '../logger.js'
import { SecretsRepository } from '../repositories/secrets.js'
import {
  TranslationError,
  TranslationService,
  buildTranslationPrompt,
  extractText,
  parseTranslationResponse,
  translatableIndexes,
} from './translation.js'

describe('buildTranslationPrompt', () => {
  it('numbers every line from 1 and states the expected count', () => {
    const prompt = buildTranslationPrompt(['夜空', '晚安'], 'en')
    expect(prompt).toContain('exactly 2 numbered lines')
    expect(prompt).toContain('1. 夜空\n2. 晚安')
    expect(prompt).toContain('"en"')
  })
})

describe('parseTranslationResponse', () => {
  it('accepts a clean numbered list', () => {
    expect(parseTranslationResponse('1. Night sky\n2. Good night', 2)).toEqual([
      'Night sky',
      'Good night',
    ])
  })

  it('tolerates chatter, blank lines, and different separators', () => {
    const reply = 'Here you go:\n\n1) Night sky\n\n2: Good night\n3. Done\n'
    expect(parseTranslationResponse(reply, 3)).toEqual(['Night sky', 'Good night', 'Done'])
  })

  it('rejects a count mismatch', () => {
    expect(parseTranslationResponse('1. only one', 2)).toBeNull()
    expect(parseTranslationResponse('1. a\n2. b\n3. c', 2)).toBeNull()
  })

  it('rejects duplicated or out-of-range numbers', () => {
    expect(parseTranslationResponse('1. a\n1. b', 2)).toBeNull()
    expect(parseTranslationResponse('0. a\n1. b', 2)).toBeNull()
  })

  it('keeps an intentionally empty translation as an empty string', () => {
    expect(parseTranslationResponse('1. a\n2.\n3. c', 3)).toEqual(['a', '', 'c'])
  })
})

describe('translatableIndexes', () => {
  it('skips blank and symbol-only lines but keeps their positions', () => {
    expect(translatableIndexes(['夜空', '', '♪', 'la la', '...'])).toEqual([0, 3])
  })
})

describe('extractText', () => {
  it('reads both provider shapes', () => {
    expect(extractText('anthropic', { content: [{ type: 'text', text: '1. a' }] })).toBe('1. a')
    expect(extractText('openai', { choices: [{ message: { content: '1. a' } }] })).toBe('1. a')
    expect(extractText('openai', {})).toBe('')
  })
})

describe('TranslationService', () => {
  const makeService = (replies: string[]) => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const secrets = new SecretsRepository(db)
    secrets.setApiKey('openai', 'sk-test')
    let calls = 0
    const fetchImpl = (() => {
      const reply = replies[Math.min(calls, replies.length - 1)] ?? ''
      calls++
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as typeof fetch
    return {
      service: new TranslationService(secrets, createLogger('silent'), fetchImpl),
      calls: () => calls,
    }
  }

  it('returns lines aligned with the original, blanks included, in one request', async () => {
    const { service, calls } = makeService(['1. Night sky\n2. Good night'])
    const result = await service.translate(
      '[00:01.00]夜空\n[00:02.00]♪\n[00:03.00]晚安',
      'en',
      'openai',
    )
    expect(calls()).toBe(1)
    expect(result.synced).toBe(true)
    expect(result.lines).toEqual([
      { time: 1, text: '夜空', translation: 'Night sky' },
      { time: 2, text: '♪', translation: '' },
      { time: 3, text: '晚安', translation: 'Good night' },
    ])
  })

  it('retries once on a misaligned reply, then gives up', async () => {
    const good = makeService(['1. only', '1. Night sky\n2. Good night'])
    const result = await good.service.translate('夜空\n晚安', 'en', 'openai')
    expect(good.calls()).toBe(2)
    expect(result.lines.map(line => line.translation)).toEqual(['Night sky', 'Good night'])

    const bad = makeService(['nonsense'])
    await expect(bad.service.translate('夜空\n晚安', 'en', 'openai')).rejects.toBeInstanceOf(
      TranslationError,
    )
    expect(bad.calls()).toBe(2)
  })

  it('fails fast without a key', async () => {
    const { service, calls } = makeService(['1. x'])
    await expect(service.translate('夜空', 'en', 'anthropic')).rejects.toMatchObject({
      code: 'no_key',
    })
    expect(calls()).toBe(0)
  })
})
