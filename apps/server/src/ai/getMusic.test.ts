import { describe, expect, it } from 'vitest'
import { song } from './fixtures/library.js'
import { getMusic } from './getMusic.js'

const track = (title: string, duration: number) => ({
  title,
  artist: 'HOYO-MiX',
  album: '原神-千岩旷望',
  duration,
  url: `https://music.163.com/song?id=${duration}`,
  thumbnail: null,
})

const music = {
  albums: async () => [
    {
      id: '1',
      url: 'https://music.163.com/album?id=1',
      title: '千岩旷望 Piano Covers',
      artist: 'Someone',
      tracks: 3,
      cover: null,
    },
    {
      id: '146627102',
      url: 'https://music.163.com/album?id=146627102',
      title: '原神-千岩旷望 Millelith’s Watch',
      artist: 'HOYO-MiX',
      tracks: 40,
      cover: null,
    },
  ],
  albumTracks: async () => [
    track('丹砂巍巍 Wordless Cliffs', 112),
    track('隐雾漫谷 Dawn in the Clouds', 150),
    // By the same artist and about as long, but another song.
    track('Another Tune', 111),
    // A cover of the same name is not yours.
    track('Wordless Cliffs（翻自 HOYO-MiX）', 113),
  ],
  songs: async () => [track('丹砂巍巍 Wordless Cliffs', 112), track('Something Else', 200)],
}

const songs = () => [song(1, { title: 'Wordless Cliffs', artist: 'HOYO-MiX', duration: 112 })]

describe('getMusic', () => {
  it('lists albums with how many of their songs are yours already', async () => {
    const answer = await getMusic(
      { songs, music },
      { words: '原神 千岩旷望 Millelith’s Watch', kind: 'album' },
    )
    // The album whose whole name was asked for comes first.
    expect(answer.items.map(item => item.title)).toEqual([
      '原神-千岩旷望 Millelith’s Watch',
      '千岩旷望 Piano Covers',
    ])
    expect({ ...answer, items: answer.items.slice(0, 1) }).toEqual({
      kind: 'getMusic',
      words: '原神 千岩旷望 Millelith’s Watch',
      items: [
        {
          kind: 'album',
          title: '原神-千岩旷望 Millelith’s Watch',
          artist: 'HOYO-MiX',
          url: 'https://music.163.com/album?id=146627102',
          cover: null,
          tracks: 4,
          have: 1,
        },
      ],
    })
  })

  it('lists songs, each saying whether you have it', async () => {
    const answer = await getMusic({ songs, music }, { words: 'Wordless Cliffs', kind: 'song' })
    expect(answer.items.map(item => `${item.title}|${item.have}`)).toEqual([
      '丹砂巍巍 Wordless Cliffs|1',
      'Something Else|0',
    ])
  })
})
