import { describe, expect, it } from 'vitest'
import type { AskObject } from '@selfmp3/shared'
import { endpointLlm, SONGS, TAGS } from './fixtures/library.js'
import { explore } from './explore.js'
import type { Llm } from './llm.js'

const deps = (llm: Llm, web = false) => ({
  llm,
  songs: () => SONGS,
  tags: () => TAGS,
  lyrics: (query: string) => (query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : []),
  stats: () => {
    throw new Error('not asked')
  },
  catalogue: async (words: string) =>
    words === 'Liyue'
      ? [
          {
            title: '璃月 Liyue',
            artist: '陈致逸, HOYO-MiX',
            album: '原神-皎月云间之梦',
            duration: 276,
          },
        ]
      : [],
  web: () => web,
})

/** What each tool call of a request was answered with, in order. */
function toolResults(llm: ReturnType<typeof endpointLlm>, request: number): unknown[] {
  return llm.sent['ask-explore']![request]!.messages.filter(each => each.role === 'tool').map(
    each => JSON.parse(each.content ?? 'null') as unknown,
  )
}

const shown: AskObject = {
  handle: 't1.1',
  kind: 'songs',
  label: 'J-pop',
  songIds: [7, 8, 9],
  why: [null, null, null],
  playlist: null,
  lead: 'play',
  like: null,
  understanding: null,
}

describe('explore', () => {
  it('runs a reply’s calls in order, a later one using the set an earlier one made', async () => {
    const llm = endpointLlm({
      'ask-explore': [
        {
          calls: [
            { name: 'find_songs', args: { as: 'yoasobi', artist: ['YOASOBI'] } },
            { name: 'count_by', args: { scope: { set: 'yoasobi' }, by: 'album' } },
            { name: 'catalogue', args: { words: 'Liyue' } },
          ],
        },
        // 14 was never shown, 999 is nobody's: neither is named.
        { say: 'Two YOASOBI songs.', songs: [8, 14, 999], set: null, get: null },
      ],
    })
    const steps: string[] = []
    const answer = await explore(deps(llm), 'how many YOASOBI songs do I have?', {
      begin: text => steps.push(text),
      update: () => undefined,
      done: () => undefined,
    })

    expect(answer).toEqual({ kind: 'explore', say: 'Two YOASOBI songs.', songIds: [8], get: null })
    const [found, counted, catalogue] = toolResults(llm, 1) as [
      { count: number },
      { groups: unknown[] },
      { title: string }[],
    ]
    expect(found.count).toBe(2)
    expect(counted.groups).toEqual([
      { name: 'THE BOOK — YOASOBI', songs: 1 },
      { name: 'アイドル — YOASOBI', songs: 1 },
    ])
    expect(catalogue[0]!.title).toBe('璃月 Liyue')
    expect(steps).toContain('Looking up “Liyue” on 网易云')
    // One round of calls, then the answer: tools offered both times.
    expect(llm.sent['ask-explore']!.map(each => each.tool_choice)).toEqual(['auto', 'auto'])
  })

  it('starts from the song playing and what earlier answers showed, and answers with a set', async () => {
    const llm = endpointLlm({
      'ask-explore': [
        { say: 'These three, and the one playing.', songs: [5], set: 't1.1', get: null },
      ],
    })
    const answer = await explore(deps(llm), 'which of these are by Yorushika?', undefined, {
      playing: SONGS[4],
      objects: [shown],
      screen: 't1.1',
    })
    expect(answer.songIds).toEqual([7, 8, 9, 5])
    const prompt = llm.prompts['ask-explore']![0]!
    expect(prompt).toContain(
      '- playing: 1 song, the song playing (“Liyue” · Yu-Peng Chen, HOYO-MiX)',
    )
    expect(prompt).toContain('- t1.1: 3 songs, J-pop')
    expect(prompt).toContain('- screen: 3 songs, on their screen: t1.1')
  })

  it('sends a call that fails back to the model as its result, and goes on', async () => {
    const llm = endpointLlm({
      'ask-explore': [
        {
          calls: [
            { name: 'find_songs', args: { as: 'a', scope: { ids: [14] } } },
            { name: 'find_songs', args: { as: 'b', scope: { set: 'nope' } } },
            { name: 'find_songs', args: { as: '1 bad' } },
            { name: 'find_songs', args: { as: 'c', artist: ['周杰倫'] } },
          ],
        },
        { say: 'Three by 周杰倫.', songs: [14], set: null, get: null },
      ],
    })
    const answer = await explore(deps(llm), 'what do I have by 周杰倫?')
    expect(answer.songIds).toEqual([14])
    const [stranger, unknown, misnamed, found] = toolResults(llm, 1) as {
      error?: string
      count?: number
    }[]
    expect(stranger!.error).toContain('14 is not an id you were shown')
    expect(unknown!.error).toContain('There is no set called “nope”')
    expect(misnamed!.error).toContain('Wrong arguments')
    expect(found!.count).toBe(3)
  })

  it('may search the web when the server lets it', async () => {
    const llm = endpointLlm({
      'ask-explore': [{ say: 'From the web.', songs: [], set: null, get: null }],
    })
    await explore(deps(llm, true), 'what game is this from?')
    const body = llm.sent['ask-explore']![0]! as unknown as Record<string, unknown>
    expect(body['web_search_options']).toEqual({})
    expect(llm.sent['ask-explore']![0]!.messages[0]!.content).toContain('search the web')
  })
})
