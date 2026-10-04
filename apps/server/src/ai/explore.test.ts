import { describe, expect, it } from 'vitest'
import { SONGS, TAGS } from './fixtures/library.js'
import { explore } from './explore.js'
import type { GenerateRequest, Llm } from './llm.js'

/** A model that looks things up with the tools it is given, then answers. */
function lookingLlm(
  calls: { name: string; args: unknown }[],
  answer: { say: string; songs: number[] },
) {
  const seen: { name: string; result: unknown }[] = []
  const asked: GenerateRequest<unknown>[] = []
  const llm: Llm = {
    async generate<T>(request: GenerateRequest<T>) {
      asked.push(request as GenerateRequest<unknown>)
      for (const call of calls) {
        const found = request.tools?.find(each => each.name === call.name)
        if (!found) throw new Error(`no tool ${call.name}`)
        const args = found.parameters.parse(call.args)
        seen.push({ name: call.name, result: await found.run(args as never) })
      }
      return { value: request.schema.parse(answer), ms: 1 }
    },
  }
  return { llm, seen, asked }
}

const deps = (llm: Llm, web = false) => ({
  llm,
  songs: () => SONGS,
  tags: () => TAGS,
  lyrics: (query: string) => (query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : []),
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

describe('explore', () => {
  it('looks through the library and the catalogue, and names only songs that are yours', async () => {
    const { llm, seen, asked } = lookingLlm(
      [
        {
          name: 'search_songs',
          args: { words: 'liyue', tag: null, artist: null, album: null, limit: null, offset: null },
        },
        {
          name: 'search_songs',
          args: { words: '外婆', tag: null, artist: null, album: null, limit: null, offset: null },
        },
        { name: 'library_counts', args: { by: 'album', tag: '原神纯音乐', artist: null } },
        { name: 'search_catalogue', args: { words: 'Liyue' } },
      ],
      { say: 'Liyue is 璃月 in Chinese.', songs: [5, 5, 999] },
    )
    const steps: string[] = []
    const answer = await explore(deps(llm), 'what is Liyue called in Chinese?', {
      begin: text => steps.push(text),
      done: () => undefined,
    })

    expect(answer).toEqual({ kind: 'explore', say: 'Liyue is 璃月 in Chinese.', songIds: [5] })
    const [byTitle, byLyrics, albums, catalogue] = seen.map(each => each.result) as [
      { total: number; songs: { id: number; tags: string[] }[] },
      { songs: { id: number }[] },
      { name: string; songs: number }[],
      { title: string }[],
    ]
    expect(byTitle.total).toBe(1)
    expect(byTitle.songs[0]).toMatchObject({ id: 5, tags: ['原神纯音乐'] })
    expect(byLyrics.songs.map(song => song.id)).toEqual([15])
    expect(albums.map(each => each.songs).reduce((a, b) => a + b, 0)).toBe(3)
    expect(catalogue[0]!.title).toBe('璃月 Liyue')
    expect(steps).toContain('Looking through your songs for “liyue”')
    expect(steps).toContain('Looking up “Liyue” on 网易云')
    expect(asked[0]!.webSearch).toBe(false)
    expect(asked[0]!.system).not.toContain('search the web')
  })

  it('may search the web when Settings allows it', async () => {
    const { llm, asked } = lookingLlm([], { say: 'From the web.', songs: [] })
    await explore(deps(llm, true), 'what game is this from?')
    expect(asked[0]!.webSearch).toBe(true)
    expect(asked[0]!.system).toContain('search the web')
  })
})
