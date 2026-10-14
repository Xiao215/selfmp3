import { describe, expect, it } from 'vitest'
import { endpointLlm } from './fixtures/library.js'
import { grounded, importNames } from './importNames.js'
import { LlmError } from './llm.js'

const row = (title: string, artist = '', album = '') => ({ title, artist, album, duration: 200 })

describe('an import’s names, read by the model', () => {
  it('keeps a name only when its words are the row’s own or the list’s', () => {
    const idol = row('YOASOBI - アイドル | 推しの子 OP', 'Ayase Official')
    // Moved and trimmed: kept.
    expect(
      grounded(idol, null, {
        title: 'アイドル',
        artist: 'YOASOBI',
        album: '',
        why: 'Artist in the title',
      }),
    ).toEqual({ title: 'アイドル', artist: 'YOASOBI', album: '', why: 'Artist in the title' })
    // A translation is no word of the row's: the title stays, and so nothing is left to say.
    expect(
      grounded(row('アイドル', 'YOASOBI'), null, {
        title: 'Idol',
        artist: 'YOASOBI',
        album: '',
        why: 'x',
      }),
    ).toBeNull()
    // The list's name may give the album.
    expect(
      grounded(row('Dream Aria', 'HOYO-MiX', 'Uploads'), 'The Wind and the Star Traveler', {
        title: 'Dream Aria',
        artist: 'HOYO-MiX',
        album: 'The Wind and the Star Traveler',
        why: 'Album from the list',
      }),
    ).toMatchObject({ album: 'The Wind and the Star Traveler' })
    // An artist is never emptied; an album may be. Why reads as a sentence.
    expect(
      grounded(row('A', 'B', 'C'), null, {
        title: 'A',
        artist: '',
        album: '',
        why: 'album was the channel',
      }),
    ).toEqual({
      title: 'A',
      artist: 'B',
      album: '',
      why: 'Album was the channel',
    })
  })

  it('answers each row by its place in the whole list, across calls', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => row(`Song ${index}`, 'Someone'))
    rows[65] = row('Someone - Song 65', 'Someone - Topic')
    const llm = endpointLlm({
      'import-names': [
        { rows: [] },
        {
          rows: [
            { n: 6, title: 'Song 65', artist: 'Someone', album: '', why: 'Artist in the title' },
          ],
        },
      ],
    })
    const answer = await importNames({ llm }, { list: 'Mix', rows })
    expect(answer.suggestions).toEqual([
      { row: 65, title: 'Song 65', artist: 'Someone', album: '', why: 'Artist in the title' },
    ])
    expect(llm.prompts['import-names']![0]).toContain('The list: Mix')
    expect(llm.prompts['import-names']![1]).toContain(
      '6 | Someone - Song 65 | Someone - Topic | - | 3:20',
    )
  })

  it('fails as the model did when no call answered', async () => {
    const llm = endpointLlm({ 'import-names': [401] })
    await expect(importNames({ llm }, { list: null, rows: [row('a')] })).rejects.toBeInstanceOf(
      LlmError,
    )
  })
})
