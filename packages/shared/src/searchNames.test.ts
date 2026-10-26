import { describe, expect, it } from 'vitest'
import { tidyArtistNames } from './artists.js'
import { fuzzyRankNames } from './fuzzy.js'
import type { Song } from './schemas/song.js'
import {
  NO_NAMES,
  artistSearchNames,
  namesFor,
  namesToSpell,
  songSearchNames,
  type LibraryNames,
} from './searchNames.js'

const song = (id: number, title: string, artist: string, album = '') =>
  ({ id, title, artist, album }) as Song

const songs = [
  song(1, '晴る', 'ヨルシカ'),
  song(2, 'Sukidakara', 'Yuika'),
  song(3, '晴天', '周杰伦'),
  song(4, 'Hikarunara', 'Goose house'),
  song(5, 'ロマンスの約束', '幾田りら'),
  song(6, 'Secret Base -Kimiga Kuretamono', 'ZONE'),
]

/** What the server would have worked out for this library. */
const names: LibraryNames = {
  artistNames: {
    ヨルシカ: ['Yorushika'],
    周杰伦: ['周杰倫', 'Jay Chou', 'Zhou Jielun'],
    幾田りら: ['ikura', 'Lilas Ikuta'],
  },
  spellings: {
    晴る: ['qing ru', 'haru'],
    ヨルシカ: ['yorushika'],
    晴天: ['qing tian', 'seiten'],
    周杰伦: ['zhou jie lun', 'shuu ketsu ron'],
    ロマンスの約束: ['romansu no yakusoku'],
    幾田りら: ['iku ta ri ra'],
  },
}

const search = (query: string, with_: LibraryNames = names) =>
  fuzzyRankNames(query, songs, item => songSearchNames(item, with_)).map(match => match.item.id)

describe('search by the names things also go by', () => {
  it('finds an artist by the name they perform under, first', () => {
    expect(search('ikura')[0]).toBe(5)
    // Without the server's names, nothing: a song's letters falling in order
    // through "Hikarunara" are not a match (X2).
    expect(search('ikura', NO_NAMES)).toEqual([])
  })

  it('finds a name in characters by its spelling, run together as typed', () => {
    expect(search('ikuta')[0]).toBe(5)
    expect(search('zhoujielun')).toEqual([3])
    expect(search('yorushika')).toEqual([1])
  })

  it('finds a name in characters by the initials of its spelling', () => {
    expect(search('zjl')).toEqual([3])
  })

  it('forgives a typo in one name, not only in the whole of a song', () => {
    expect(search('jay chow')).toEqual([3])
    expect(search('jay chou', NO_NAMES)).toEqual([])
  })

  it('finds a name in the other script it is written in', () => {
    expect(search('周杰倫')).toEqual([3])
  })

  it('still reads a song as its title, artist and album together', () => {
    expect(search('goose hikaru')).toEqual([])
    expect(search('hikarunara goose')).toEqual([4])
  })
})

describe('the names a song and an artist are found by', () => {
  it('reads the whole song first, then each name and its spellings', () => {
    expect(songSearchNames(song(3, '晴天', '周杰伦 & ZONE'), names)).toEqual([
      '晴天 周杰伦 & ZONE ',
      '晴天',
      'qing tian',
      'qingtian',
      'seiten',
      '周杰伦',
      'zhou jie lun',
      'zhoujielun',
      'shuu ketsu ron',
      'shuuketsuron',
      '周杰倫',
      'Jay Chou',
      'Zhou Jielun',
      'ZONE',
    ])
  })

  it('finds an artist written any way that compares equal', () => {
    expect(
      artistSearchNames('YORUSHIKA', { ...names, artistNames: { yorushika: ['ヨルシカ'] } }),
    ).toEqual(['YORUSHIKA', 'ヨルシカ', 'yorushika'])
  })
})

describe('what the server spells', () => {
  it('is every Chinese and Japanese name, and the names artists go by, never Korean', () => {
    const wanted = namesToSpell(
      [song(1, '晴る', 'ヨルシカ, 아이유', 'Album'), song(2, 'Lemon', 'Kenshi Yonezu', '')],
      { 'kenshi yonezu': ['米津玄師', 'Yonezu Kenshi'] },
    )
    expect([...wanted].sort()).toEqual(['ヨルシカ', '晴る', '米津玄師'].sort())
  })
})

describe('an artist’s other names as they are kept', () => {
  it('keeps each once, tidied, without the artist’s own, and no more than twenty', () => {
    expect(
      tidyArtistNames('周杰伦', ['  Jay   Chou ', 'jay chou', '周杰伦', '', '周杰倫']),
    ).toEqual(['Jay Chou', '周杰倫'])
    const many = Array.from({ length: 30 }, (_, i) => `Name ${i}`)
    expect(tidyArtistNames('Someone', many)).toHaveLength(20)
  })
})

describe('names that are also an object’s own keys', () => {
  it.each(['__proto__', 'constructor', 'Constructor', 'toString', 'hasOwnProperty'])(
    'finds a song by %s without reading what objects inherit',
    name => {
      const odd = song(9, name, name, name)
      expect(songSearchNames(odd, NO_NAMES)).toContain(name)
      expect(artistSearchNames(name, names)).toEqual([name])
      expect(namesFor(NO_NAMES.artistNames, name)).toEqual([])
    },
  )

  it('still reads a name that really is "__proto__", as JSON brings it', () => {
    const parsed = JSON.parse(
      '{"artistNames":{"__proto__":["Proto"]},"spellings":{}}',
    ) as LibraryNames
    expect(artistSearchNames('__proto__', parsed)).toEqual(['__proto__', 'Proto'])
  })
})
