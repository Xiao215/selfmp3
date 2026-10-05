import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createLogger } from '../logger.js'
import { jsonSchemaOf, LlmError, openAiCompatible, parseReply, Remembered, tool } from './llm.js'

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

  it('stops when nobody waits: the call in flight is dropped, and none is made after', async () => {
    const waiting = new AbortController()
    let seen: AbortSignal | undefined
    // A model that answers only when its call is aborted, the way a slow one hangs.
    const fetch = (_url: string, init?: RequestInit): Promise<Response> => {
      seen = init?.signal ?? undefined
      return new Promise((_resolve, reject) =>
        seen!.addEventListener('abort', () => reject(new Error('aborted'))),
      )
    }
    const llm = openAiCompatible(settings, { fetch, logger })
    const asked = llm.generate({ ...request, signal: waiting.signal })
    waiting.abort()
    await expect(asked).rejects.toMatchObject({ kind: 'stopped' })
    expect(seen?.aborted).toBe(true)

    const { fetch: never, calls } = fakeFetch()
    await expect(
      openAiCompatible(settings, { fetch: never, logger }).generate({
        ...request,
        signal: waiting.signal,
      }),
    ).rejects.toMatchObject({ kind: 'stopped' })
    expect(calls).toHaveLength(0)
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

describe('tools', () => {
  const calls = (...list: { name: string; args: string }[]): Response =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: list.map((each, index) => ({
                id: `call_${index}`,
                type: 'function',
                function: { name: each.name, arguments: each.args },
              })),
            },
          },
        ],
      }),
    )
  const ran: string[] = []
  const search = tool({
    name: 'search_songs',
    description: 'Find songs',
    parameters: z.object({ text: z.string() }),
    run: ({ text }) => {
      ran.push(text)
      return [{ id: 1, title: `${text} song` }]
    },
  })

  it('runs the model’s calls here, sends the results back, then takes its answer', async () => {
    ran.length = 0
    const { fetch, calls: sent } = fakeFetch(
      calls({ name: 'search_songs', args: '{"text":"rain"}' }, { name: 'nope', args: '{}' }),
      calls({ name: 'search_songs', args: '{"text": 3}' }),
      reply('{"n": 1, "why": "found it"}'),
    )
    const llm = openAiCompatible(settings, { fetch, logger })
    const { value } = await llm.generate({ ...request, tools: [search], webSearch: true })

    expect(value).toEqual({ n: 1, why: 'found it' })
    expect(ran).toEqual(['rain'])
    const first = sent[0]!.body
    expect(first['tools']).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_songs',
          description: 'Find songs',
          parameters: jsonSchemaOf(z.object({ text: z.string() })),
        },
      },
    ])
    expect(first['tool_choice']).toBe('auto')
    expect(first['web_search_options']).toEqual({})
    // The results go back as tool messages, a wrong name or wrong arguments as an error.
    const messages = sent[2]!.body['messages'] as { role: string; content: string }[]
    expect(messages.filter(m => m.role === 'tool').map(m => m.content)).toEqual([
      '[{"id":1,"title":"rain song"}]',
      '{"error":"There is no tool called nope."}',
      expect.stringContaining('Wrong arguments'),
    ])
  })

  it('stops offering calls after its rounds, so the model has to answer', async () => {
    const { fetch, calls: sent } = fakeFetch(
      calls({ name: 'search_songs', args: '{"text":"a"}' }),
      reply('{"n": 2, "why": "enough"}'),
    )
    const llm = openAiCompatible(settings, { fetch, logger })
    const { value } = await llm.generate({ ...request, tools: [search], maxRounds: 1 })
    expect(value).toEqual({ n: 2, why: 'enough' })
    expect(sent.map(each => each.body['tool_choice'])).toEqual(['auto', 'none'])
    expect(sent[0]!.body['web_search_options']).toBeUndefined()
  })
})
