import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createLogger } from '../logger.js'
import { jsonSchemaOf, LlmError, openAiCompatible, parseReply, Remembered } from './llm.js'

const logger = createLogger('silent')
const Answer = z.object({ n: z.number().int(), why: z.string() })

const settings = {
  baseUrl: 'http://127.0.0.1:8787/v1/',
  apiKey: 'k',
  models: { fast: 'haiku', smart: 'sonnet' },
  timeoutMs: 1000,
}

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
}

function fakeFetch(...responses: Response[]) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
    []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: init?.headers as Record<string, string>,
    })
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    return next
  }
  return { fetch, calls }
}

const request = {
  task: 'test-task',
  tier: 'fast' as const,
  system: 'sys',
  prompt: 'hi',
  schema: Answer,
}

describe('openAiCompatible', () => {
  it('asks for the tier’s model with the schema, and returns the checked answer', async () => {
    const { fetch, calls } = fakeFetch(reply('{"n": 2, "why": "calm"}'))
    const llm = openAiCompatible(settings, { fetch, logger })

    const { value } = await llm.generate(request)

    expect(value).toEqual({ n: 2, why: 'calm' })
    expect(calls[0]!.url).toBe('http://127.0.0.1:8787/v1/chat/completions')
    expect(calls[0]!.headers['Authorization']).toBe('Bearer k')
    expect(calls[0]!.body['model']).toBe('haiku')
    expect(calls[0]!.body['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'test-task', strict: true, schema: jsonSchemaOf(Answer) },
    })
  })

  it('reads a reply wrapped in a code fence', async () => {
    const { fetch } = fakeFetch(reply('```json\n{"n": 1, "why": "x"}\n```'))
    const { value } = await openAiCompatible(settings, { fetch, logger }).generate(request)
    expect(value.n).toBe(1)
  })

  it('sends a reply that does not fit back once, with what was wrong', async () => {
    const { fetch, calls } = fakeFetch(reply('{"n": "two"}'), reply('{"n": 2, "why": "fixed"}'))
    const { value } = await openAiCompatible(settings, { fetch, logger }).generate(request)

    expect(value).toEqual({ n: 2, why: 'fixed' })
    const repair = (calls[1]!.body['messages'] as { role: string; content: string }[]).at(-1)!
    expect(repair.role).toBe('user')
    expect(repair.content).toMatch(/does not match/)
  })

  it('gives up after a second reply that does not fit', async () => {
    const { fetch } = fakeFetch(reply('not json'), reply('{"n": 1}'))
    await expect(
      openAiCompatible(settings, { fetch, logger }).generate(request),
    ).rejects.toMatchObject({
      kind: 'invalid',
    })
  })

  it('says what kind of failure it was', async () => {
    const busy = openAiCompatible(settings, {
      fetch: fakeFetch(new Response('limit', { status: 429 })).fetch,
      logger,
    })
    await expect(busy.generate(request)).rejects.toMatchObject({ kind: 'busy' })

    const refused = openAiCompatible(settings, {
      fetch: fakeFetch(new Response('no', { status: 401 })).fetch,
      logger,
    })
    await expect(refused.generate(request)).rejects.toMatchObject({ kind: 'refused' })

    const down = openAiCompatible(settings, {
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      logger,
    })
    await expect(down.generate(request)).rejects.toBeInstanceOf(LlmError)
    await expect(down.generate(request)).rejects.toMatchObject({ kind: 'unreachable' })
  })
})

describe('parseReply', () => {
  it('reads bare JSON and fenced JSON alike', () => {
    expect(parseReply('{"a":1}')).toEqual({ a: 1 })
    expect(parseReply('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })
})

describe('Remembered', () => {
  it('makes an answer once per input while it is fresh', async () => {
    const remembered = new Remembered(1000)
    let made = 0
    const make = async () => ++made
    expect(await remembered.get('k', make, 0)).toBe(1)
    expect(await remembered.get('k', make, 500)).toBe(1)
    expect(await remembered.get('k', make, 1500)).toBe(2)
    expect(Remembered.key('a', 1)).not.toBe(Remembered.key('a', 2))
  })
})
