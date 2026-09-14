import { describe, expect, it } from 'vitest'
import {
  extractUrls,
  isYouTubeUrl,
  youtubeChannel,
  youtubeMusicSearch,
  youtubeVideoId,
} from './links.js'

describe('extractUrls', () => {
  it('finds one link per line', () => {
    expect(extractUrls('https://a.example/one\n  https://b.example/two  \n')).toEqual([
      'https://a.example/one',
      'https://b.example/two',
    ])
  })

  it('pulls links out of shared free text and strips trailing punctuation', () => {
    const text =
      'Check this out: https://youtu.be/dQw4w9WgXcQ. Also https://music.youtube.com/watch?v=abc&list=x)'
    expect(extractUrls(text)).toEqual([
      'https://youtu.be/dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=abc&list=x',
    ])
  })

  it('ignores non-http schemes and junk', () => {
    expect(extractUrls('ftp://x.example/y not a link www.example.com')).toEqual([])
  })

  it('de-duplicates and caps', () => {
    expect(extractUrls('https://x.example/a https://x.example/a')).toEqual(['https://x.example/a'])
    const many = Array.from({ length: 30 }, (_, i) => `https://x.example/${i}`).join(' ')
    expect(extractUrls(many)).toHaveLength(20)
    expect(extractUrls(many, 3)).toHaveLength(3)
  })
})

describe('isYouTubeUrl', () => {
  it('recognises the YouTube hosts', () => {
    expect(isYouTubeUrl('https://music.youtube.com/playlist?list=LM')).toBe(true)
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('https://youtu.be/x')).toBe(true)
    expect(isYouTubeUrl('https://soundcloud.com/x')).toBe(false)
    expect(isYouTubeUrl('nope')).toBe(false)
  })
})

describe('youtubeVideoId', () => {
  it('reads the id from every form of a video link', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=fCh0qfxElm8')).toBe('fCh0qfxElm8')
    expect(youtubeVideoId('https://music.youtube.com/watch?v=fCh0qfxElm8&list=RD')).toBe(
      'fCh0qfxElm8',
    )
    expect(youtubeVideoId('https://youtu.be/fCh0qfxElm8?si=abc')).toBe('fCh0qfxElm8')
    expect(youtubeVideoId('https://www.youtube.com/shorts/fCh0qfxElm8')).toBe('fCh0qfxElm8')
  })

  it('has nothing for links that are not one video', () => {
    expect(youtubeVideoId('https://music.youtube.com/playlist?list=LM')).toBeNull()
    expect(youtubeVideoId('https://soundcloud.com/x?v=fCh0qfxElm8')).toBeNull()
    expect(youtubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(youtubeVideoId(null)).toBeNull()
  })
})

describe('youtubeMusicSearch', () => {
  it('reads the words searched for on YouTube Music, and nothing from any other link', () => {
    expect(youtubeMusicSearch('https://music.youtube.com/search?q=yoasobi')).toBe('yoasobi')
    expect(youtubeMusicSearch('https://music.youtube.com/search?q=%E5%A4%9C%E3%81%AB+%E9%A7%86%E3%81%91%E3%82%8B')).toBe(
      '夜に 駆ける',
    )
    expect(youtubeMusicSearch('https://music.youtube.com/search?q=')).toBeNull()
    expect(youtubeMusicSearch('https://www.youtube.com/results?search_query=yoasobi')).toBeNull()
    expect(youtubeMusicSearch('https://music.youtube.com/watch?v=by4SYYWlhEs')).toBeNull()
    expect(youtubeMusicSearch('not a link')).toBeNull()
  })
})

describe('youtubeChannel', () => {
  it('reads a handle or a channel id from the front page, on either host', () => {
    expect(youtubeChannel('https://music.youtube.com/@YOASOBI_Official')).toEqual({
      handle: '@YOASOBI_Official',
    })
    expect(youtubeChannel('https://www.youtube.com/@YOASOBI_Official/featured')).toEqual({
      handle: '@YOASOBI_Official',
    })
    expect(youtubeChannel('https://m.youtube.com/@YOASOBI_Official?si=x')).toEqual({
      handle: '@YOASOBI_Official',
    })
    expect(youtubeChannel('https://music.youtube.com/channel/UCvpredjG93ifbCP1Y77JyFA')).toEqual({
      channelId: 'UCvpredjG93ifbCP1Y77JyFA',
    })
  })

  it('decodes a handle written in another script', () => {
    expect(youtubeChannel('https://www.youtube.com/@%E3%83%A8%E3%82%A2%E3%82%BD%E3%83%93')).toEqual(
      {
        handle: '@ヨアソビ',
      },
    )
  })

  it('leaves tabs, videos, playlists and other sites alone', () => {
    expect(youtubeChannel('https://www.youtube.com/@YOASOBI_Official/videos')).toBeNull()
    expect(youtubeChannel('https://music.youtube.com/watch?v=x8VYWazR5mE')).toBeNull()
    expect(youtubeChannel('https://music.youtube.com/playlist?list=OLAK5uy_x')).toBeNull()
    expect(youtubeChannel('https://www.youtube.com/channel/not-a-channel-id')).toBeNull()
    expect(youtubeChannel('https://youtu.be/@x')).toBeNull()
    expect(youtubeChannel('https://soundcloud.com/@someone')).toBeNull()
  })
})
