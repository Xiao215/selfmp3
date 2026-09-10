import { describe, expect, it } from 'vitest'
import {
  cleanTitle,
  detectCsv,
  guessOrder,
  parseDelimited,
  parseDurationValue,
  parseSpotifyEmbed,
  parseTrackList,
  spotifyPlaylistId,
} from './migrateParse.js'

const brief = (tracks: { title: string; artist: string }[]) =>
  tracks.map(track => `${track.artist}|${track.title}`)

describe('cleanTitle', () => {
  it('strips bracketed noise but keeps meaningful brackets', () => {
    expect(cleanTitle('Get Lucky (Official Audio)')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky [HD]')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky (Lyrics)')).toBe('Get Lucky')
    expect(cleanTitle('Hotel California (2013 Remaster)')).toBe('Hotel California')
    expect(cleanTitle('Hotel California (Live)')).toBe('Hotel California (Live)')
    expect(cleanTitle('Blue (Da Ba Dee)')).toBe('Blue (Da Ba Dee)')
    expect(cleanTitle('Hold On (Ahead Of Time)')).toBe('Hold On (Ahead Of Time)')
  })

  it('strips Spotify-style dash suffixes', () => {
    expect(cleanTitle('Come Together - Remastered 2009')).toBe('Come Together')
    expect(cleanTitle('Bohemian Rhapsody - 2011 Remaster')).toBe('Bohemian Rhapsody')
    expect(cleanTitle('Levels - Radio Edit')).toBe('Levels')
  })

  it('strips featuring credits in every spelling', () => {
    expect(cleanTitle('Get Lucky (feat. Pharrell Williams)')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky feat. Pharrell Williams')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky ft Pharrell')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky [featuring Pharrell Williams]')).toBe('Get Lucky')
    expect(cleanTitle('Soft Cell')).toBe('Soft Cell')
    expect(cleanTitle('Left Hand Free')).toBe('Left Hand Free')
  })
})

describe('parseDurationValue', () => {
  it('reads clocks, seconds and milliseconds', () => {
    expect(parseDurationValue('3:45')).toBe(225)
    expect(parseDurationValue('1:02:03')).toBe(3723)
    expect(parseDurationValue('225')).toBe(225)
    expect(parseDurationValue('225000')).toBe(225)
    expect(parseDurationValue('225000', 'ms')).toBe(225)
    expect(parseDurationValue('4500', 'seconds')).toBe(4500)
    expect(parseDurationValue('')).toBe(0)
    expect(parseDurationValue('n/a')).toBe(0)
  })
})

describe('parseTrackList — plain text', () => {
  it('reads Artist - Title lines', () => {
    const result = parseTrackList(
      'Daft Punk - Get Lucky\nRadiohead - Creep\nRadiohead - Karma Police',
    )
    expect(result.kind).toBe('text')
    expect(brief(result.tracks)).toEqual([
      'Daft Punk|Get Lucky',
      'Radiohead|Creep',
      'Radiohead|Karma Police',
    ])
  })

  it('handles Windows newlines, a BOM, blank lines and stray whitespace', () => {
    const text = '\uFEFF  Daft Punk - Get Lucky \r\n\r\n\tRadiohead – Creep\r\n\n'
    const result = parseTrackList(text)
    expect(brief(result.tracks)).toEqual(['Daft Punk|Get Lucky', 'Radiohead|Creep'])
    expect(result.skipped).toEqual([])
  })

  it('accepts en dash, em dash and pipe separators', () => {
    const result = parseTrackList(
      'Adele – Hello\nAdele — Skyfall\nAdele | Someone Like You\nAdele—Rolling in the Deep',
    )
    expect(brief(result.tracks)).toEqual([
      'Adele|Hello',
      'Adele|Skyfall',
      'Adele|Someone Like You',
      'Adele|Rolling in the Deep',
    ])
  })

  it('flips to Title - Artist when the right-hand side is what repeats', () => {
    const result = parseTrackList(
      'Creep - Radiohead\nKarma Police - Radiohead\nGet Lucky - Daft Punk',
    )
    expect(brief(result.tracks)).toEqual([
      'Radiohead|Creep',
      'Radiohead|Karma Police',
      'Daft Punk|Get Lucky',
    ])
  })

  it('reads "Title by Artist"', () => {
    const result = parseTrackList('Hello by Adele\nCreep by Radiohead')
    expect(brief(result.tracks)).toEqual(['Adele|Hello', 'Radiohead|Creep'])
  })

  it('leaves a bare title with no artist', () => {
    const result = parseTrackList('Bohemian Rhapsody\nStand By Me')
    expect(brief(result.tracks)).toEqual(['|Bohemian Rhapsody', '|Stand By Me'])
  })

  it('keeps the hyphen inside names and splits only on the first spaced separator', () => {
    const result = parseTrackList('Jay-Z - 99 Problems\nAC/DC - T.N.T. - Live')
    expect(brief(result.tracks)).toEqual(['Jay-Z|99 Problems', 'AC/DC|T.N.T. - Live'])
  })

  it('strips numbering but not a numeric title', () => {
    const numbered = parseTrackList(
      '1. Adele - Hello\n2) Adele - Skyfall\n(3) Adele - Rumour Has It\n12: Adele - Chasing Pavements',
    )
    expect(brief(numbered.tracks)).toEqual([
      'Adele|Hello',
      'Adele|Skyfall',
      'Adele|Rumour Has It',
      'Adele|Chasing Pavements',
    ])
    const counted = parseTrackList('1 Adele - Hello\n2 Adele - Skyfall\n3 Adele - Rumour Has It')
    expect(brief(counted.tracks)).toEqual(['Adele|Hello', 'Adele|Skyfall', 'Adele|Rumour Has It'])
    const numericTitle = parseTrackList('22 - Taylor Swift\n1999 - Prince\n7 Rings - Ariana Grande')
    expect(brief(numericTitle.tracks)).toEqual([
      'Taylor Swift|22',
      'Prince|1999',
      'Ariana Grande|7 Rings',
    ])
    const numericArtist = parseTrackList('2 Chainz - Birthday Song\n2 Chainz - No Lie')
    expect(brief(numericArtist.tracks)).toEqual(['2 Chainz|Birthday Song', '2 Chainz|No Lie'])
  })

  it('does not read a capitalised or pronoun "By" as a separator', () => {
    const result = parseTrackList('Stand By Me\nStand by you\nBye Bye Bye by NSYNC')
    expect(brief(result.tracks)).toEqual(['|Stand By Me', '|Stand by you', 'NSYNC|Bye Bye Bye'])
  })

  it('picks up a trailing duration', () => {
    const result = parseTrackList(
      'Daft Punk - Get Lucky 4:08\nRadiohead - Creep (3:58)\nAdele - Hello - 4:55',
    )
    expect(result.tracks.map(track => [track.title, track.duration])).toEqual([
      ['Get Lucky', 248],
      ['Creep', 238],
      ['Hello', 295],
    ])
  })

  it('removes noise and feat. credits from titles', () => {
    const result = parseTrackList(
      'Daft Punk - Get Lucky (feat. Pharrell Williams) [Official Audio]\nEagles - Hotel California (Remastered 2011)\nQueen - Bohemian Rhapsody (Official Video) (Lyrics)',
    )
    expect(brief(result.tracks)).toEqual([
      'Daft Punk|Get Lucky',
      'Eagles|Hotel California',
      'Queen|Bohemian Rhapsody',
    ])
  })

  it('does not break on quotes and odd characters', () => {
    const result = parseTrackList(
      `"Weird Al" Yankovic - Amish Paradise\nBeyoncé - Déjà Vu\n宇多田ヒカル - First Love`,
    )
    expect(brief(result.tracks)).toEqual([
      '"Weird Al" Yankovic|Amish Paradise',
      'Beyoncé|Déjà Vu',
      '宇多田ヒカル|First Love',
    ])
  })
})

describe('guessOrder', () => {
  it('defaults to artist first on a tie', () => {
    expect(guessOrder([{ left: 'A', right: 'B' }])).toBe('artist-first')
    expect(guessOrder([])).toBe('artist-first')
  })

  it('treats a purely numeric side as the title side', () => {
    expect(
      guessOrder([
        { left: '22', right: 'Taylor Swift' },
        { left: 'Hello', right: 'Adele' },
      ]),
    ).toBe('title-first')
  })

  it('does not treat feat. as a hint either way', () => {
    expect(
      guessOrder([
        { left: 'Daft Punk', right: 'Get Lucky (feat. Pharrell)' },
        { left: 'Adele', right: 'Hello' },
      ]),
    ).toBe('artist-first')
  })
})

describe('parseDelimited', () => {
  it('handles quoted commas, doubled quotes and embedded newlines', () => {
    const rows = parseDelimited('a,"b, c","say ""hi""","line\nbreak"\r\n1,2,3,4\n', ',')
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ])
  })
})

describe('parseTrackList — CSV', () => {
  it('reads an Exportify export', () => {
    const csv = [
      '"Track URI","Track Name","Album Name","Artist Name(s)","Release Date","Duration (ms)","Popularity","Added At"',
      '"spotify:track:1","Get Lucky (feat. Pharrell Williams & Nile Rodgers)","Random Access Memories","Daft Punk, Pharrell Williams, Nile Rodgers","2013-05-17","369626","80","2020-01-01"',
      '"spotify:track:2","Creep","Pablo Honey","Radiohead","1993-02-22","238640","85","2020-01-02"',
    ].join('\n')
    expect(detectCsv(csv)).toEqual({ delimiter: ',' })
    const result = parseTrackList(csv)
    expect(result.kind).toBe('csv')
    expect(result.tracks).toEqual([
      { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories', duration: 370 },
      { title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 239 },
    ])
  })

  it('reads a TuneMyMusic export and takes the playlist name', () => {
    const csv = [
      'Track name,Artist name,Album,Playlist name,Type,ISRC',
      'Hello,Adele,25,Road Trip,Track,GBBKS1500214',
      'Skyfall,Adele,Skyfall,Road Trip,Track,',
    ].join('\r\n')
    const result = parseTrackList(csv)
    expect(result.playlistName).toBe('Road Trip')
    expect(brief(result.tracks)).toEqual(['Adele|Hello', 'Adele|Skyfall'])
  })

  it('reads an Apple Music tab-separated export', () => {
    const tsv = [
      'Name\tArtist\tComposer\tAlbum\tGrouping\tGenre\tSize\tTime',
      'Hello\tAdele\tAdele\t25\t\tPop\t9000000\t295',
      'Creep\tRadiohead\t\tPablo Honey\t\tRock\t8000000\t239',
    ].join('\n')
    const result = parseTrackList('\uFEFF' + tsv)
    expect(result.tracks).toEqual([
      { title: 'Hello', artist: 'Adele', album: '25', duration: 295 },
      { title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 239 },
    ])
  })

  it('records rows without a title as skipped', () => {
    const csv = 'Title,Artist\n,Nobody\nHello,Adele'
    const result = parseTrackList(csv)
    expect(brief(result.tracks)).toEqual(['Adele|Hello'])
    expect(result.skipped).toEqual([',Nobody'])
  })

  it('does not mistake a dash list with commas for CSV', () => {
    expect(
      detectCsv('Earth, Wind & Fire - September\nCrosby, Stills & Nash - Our House'),
    ).toBeNull()
    const result = parseTrackList(
      'Earth, Wind & Fire - September\nCrosby, Stills & Nash - Our House',
    )
    expect(brief(result.tracks)).toEqual([
      'Earth, Wind & Fire|September',
      'Crosby, Stills & Nash|Our House',
    ])
  })
})

describe('spotifyPlaylistId', () => {
  it('finds the id in the common link shapes', () => {
    expect(
      spotifyPlaylistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'),
    ).toBe('37i9dQZF1DXcBWIGoYBM5M')
    expect(
      spotifyPlaylistId('  https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M '),
    ).toBe('37i9dQZF1DXcBWIGoYBM5M')
    expect(
      spotifyPlaylistId('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M'),
    ).toBe('37i9dQZF1DXcBWIGoYBM5M')
    expect(spotifyPlaylistId('https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(spotifyPlaylistId('Daft Punk - Get Lucky')).toBeNull()
  })
})

describe('parseSpotifyEmbed', () => {
  const page = (data: unknown) =>
    `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`

  it('walks the page data to the track list', () => {
    const html = page({
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                type: 'playlist',
                name: 'Summer Mix',
                trackList: [
                  {
                    uri: 'spotify:track:1',
                    title: 'Get Lucky',
                    subtitle: 'Daft Punk, Pharrell Williams',
                    duration: 369626,
                  },
                  {
                    uri: 'spotify:track:2',
                    title: 'Creep - Remastered',
                    subtitle: 'Radiohead',
                    duration: 238640,
                  },
                  { uri: 'spotify:track:3', title: '', subtitle: '', duration: 0 },
                ],
              },
            },
          },
        },
      },
    })
    const result = parseSpotifyEmbed(html)
    expect(result?.kind).toBe('spotify')
    expect(result?.playlistName).toBe('Summer Mix')
    expect(result?.tracks).toEqual([
      { title: 'Get Lucky', artist: 'Daft Punk', album: '', duration: 370 },
      { title: 'Creep', artist: 'Radiohead', album: '', duration: 239 },
    ])
    expect(result?.skipped).toHaveLength(1)
  })

  it('returns null when the page has no data or the shape is unknown', () => {
    expect(parseSpotifyEmbed('<html></html>')).toBeNull()
    expect(parseSpotifyEmbed('<script id="__NEXT_DATA__">not json</script>')).toBeNull()
    expect(parseSpotifyEmbed(page({ props: { nothing: true } }))).toBeNull()
  })
})
