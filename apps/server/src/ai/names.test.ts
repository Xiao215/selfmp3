import { describe, expect, it } from 'vitest'
import { song } from './fixtures/library.js'
import { catalogueFinder, sameRecording, within } from './names.js'

const cliffs = song(1, { title: 'Wordless Cliffs', artist: 'HOYO-MiX', duration: 112 })

describe('the same recording', () => {
  it('takes the publisher’s entry and leaves a cover of the same name', () => {
    const official = {
      source: '网易云' as const,
      title: '丹砂巍巍 Wordless Cliffs',
      artist: 'HOYO-MiX',
      album: '原神-千岩旷望 Millelith’s Watch',
      seconds: 112,
    }
    expect(sameRecording(cliffs, official)).toBe(true)
    // A piano cover: the same title, but not the same length.
    expect(sameRecording(cliffs, { ...official, artist: 'Fenvalur', seconds: 120 })).toBe(false)
    // The same length by chance: neither its title nor its artist is the song's.
    expect(
      sameRecording(cliffs, { ...official, title: '璃月', artist: 'Someone', seconds: 111 }),
    ).toBe(false)
    // A fan's upload says it is a cover.
    expect(
      sameRecording(cliffs, {
        ...official,
        title: 'Wordless Cliffs（翻自 HOYO-MiX）',
        artist: '弥生',
      }),
    ).toBe(false)
    // A catalogue that does not say how long it is cannot be checked.
    expect(sameRecording(cliffs, { ...official, seconds: null })).toBe(false)
  })

  it('reads names as letters only', () => {
    expect(within('千岩旷望', '原神-千岩旷望 Millelith’s Watch')).toBe(true)
    expect(within('Ｌｉｙｕｅ', 'liyue')).toBe(true)
    expect(within('', 'anything')).toBe(false)
  })
})

describe('the catalogue finder', () => {
  it('asks 网易云 first and the others only when it has nothing, once a day per song', async () => {
    const asked: string[] = []
    const find = catalogueFinder({
      netease: async words => {
        asked.push(`netease ${words}`)
        return words.startsWith('Wordless')
          ? [
              {
                title: '丹砂巍巍 Wordless Cliffs',
                artist: 'HOYO-MiX',
                album: '原神-千岩旷望',
                duration: 112,
              },
              {
                title: 'Wordless Cliffs',
                artist: 'Fenvalur',
                album: 'Piano of Liyue',
                duration: 120,
              },
            ]
          : []
      },
      lookup: async query => {
        asked.push(`lookup ${query.title}`)
        return [
          {
            source: 'musicbrainz',
            title: 'Liyue 璃月',
            artist: 'Yu-Peng Chen',
            album: 'Jade Moon Upon a Sea of Clouds',
            durationSec: 200,
            score: 1,
          },
        ]
      },
    })
    expect(await find(cliffs)).toEqual([
      {
        source: '网易云',
        title: '丹砂巍巍 Wordless Cliffs',
        artist: 'HOYO-MiX',
        album: '原神-千岩旷望',
      },
    ])
    const liyue = song(2, { title: 'Liyue', artist: 'Yu-Peng Chen, HOYO-MiX', duration: 199 })
    expect(await find(liyue)).toEqual([
      {
        source: 'MusicBrainz',
        title: 'Liyue 璃月',
        artist: 'Yu-Peng Chen',
        album: 'Jade Moon Upon a Sea of Clouds',
      },
    ])
    await find(cliffs)
    expect(asked).toEqual([
      'netease Wordless Cliffs HOYO-MiX',
      'netease Liyue Yu-Peng Chen',
      'lookup Liyue',
    ])
  })
})
