import { describe, expect, it } from 'vitest'
import { isRateLimited, musicCredits } from '@selfmp3/shared'
import { describeVideo, downloadAudio, type YtSession } from './download.js'

/**
 * A session whose YouTube answers each client as YouTube did on 2026-10-29:
 * signed in, the clients that take no account answer 400 and WEB_CREATOR
 * gives the song; signed out, WEB_CREATOR asks for a sign-in and VISIONOS
 * gives the song. Only the client choice is real here.
 */
function session(signedInAtYouTube: { value: boolean }, believed = false) {
  const asked: string[] = []
  const song = new Uint8Array([1, 2, 3])
  const playable = {
    playability_status: { status: 'OK' },
    basic_info: {
      title: 'Song',
      author: 'Artist',
      duration: 3,
      short_description: '',
      thumbnail: [],
    },
    chooseFormat: () => ({
      itag: 140,
      mime_type: 'audio/mp4; codecs="mp4a.40.2"',
      content_length: String(song.length),
      decipher: () => Promise.resolve('https://rr1---sn-x.googlevideo.com/videoplayback?pot=a'),
    }),
  }
  const getBasicInfo = (_videoId: string, { client }: { client: string }) => {
    asked.push(client)
    const takesNoAccount = ['VISIONOS', 'IOS', 'ANDROID_VR'].includes(client)
    if (signedInAtYouTube.value && takesNoAccount) {
      return Promise.reject(new Error('Request to  failed with status code 400'))
    }
    if (!signedInAtYouTube.value && client === 'WEB_CREATOR') {
      return Promise.resolve({
        ...playable,
        playability_status: { status: 'LOGIN_REQUIRED', reason: 'Please sign in' },
      })
    }
    if (client === 'MWEB') return Promise.reject(new Error('MWEB should not be asked'))
    return Promise.resolve(playable)
  }
  const s = {
    innertube: { getBasicInfo, session: { player: null } },
    fetch: () => Promise.resolve(new Response(song)),
    visitorData: 'visitor',
    minter: null,
    account: { signedIn: believed },
  } as unknown as YtSession
  return { session: s, asked }
}

describe('which clients a download asks', () => {
  it('learns the request went signed in, and asks the clients that take an account', async () => {
    const youtube = { value: true }
    const { session: s, asked } = session(youtube)
    const audio = await downloadAudio(s, 'aaaaaaaaaaa')
    expect(audio.client).toBe('WEB_CREATOR')
    // Not MWEB, whose links stop at a megabyte signed in: straight to the ones that suit.
    expect(asked).toEqual(['VISIONOS', 'WEB_CREATOR'])
    expect(s.account.signedIn).toBe(true)

    // The next song starts where the last one ended up.
    asked.length = 0
    await downloadAudio(s, 'bbbbbbbbbbb')
    expect(asked).toEqual(['WEB_CREATOR'])
  })

  it('learns the sign-in was turned off, and goes back to the clients for none', async () => {
    const youtube = { value: false }
    const { session: s, asked } = session(youtube, true)
    const audio = await downloadAudio(s, 'aaaaaaaaaaa')
    expect(audio.client).toBe('VISIONOS')
    expect(asked).toEqual(['WEB_CREATOR', 'VISIONOS'])
    expect(s.account.signedIn).toBe(false)
  })

  it('asks clients named as they are, and learns nothing from them', async () => {
    const { session: s, asked } = session({ value: true })
    await expect(downloadAudio(s, 'aaaaaaaaaaa', { clients: ['VISIONOS'] })).rejects.toThrow(
      /status code 400/,
    )
    expect(asked).toEqual(['VISIONOS'])
    expect(s.account.signedIn).toBe(false)
  })

  it('describes a video signed in, asking once more with a client that suits', async () => {
    const { session: s, asked } = session({ value: true })
    await expect(describeVideo(s, 'aaaaaaaaaaa')).resolves.toMatchObject({ title: 'Song' })
    expect(asked).toEqual(['VISIONOS', 'WEB_CREATOR'])
  })

  it('does not ask again for a failure that says nothing of the sign-in', async () => {
    const { session: s, asked } = session({ value: false })
    ;(s.innertube as unknown as { getBasicInfo: unknown }).getBasicInfo = (
      _videoId: string,
      { client }: { client: string },
    ) => {
      asked.push(client)
      return Promise.reject(new Error('Video unavailable'))
    }
    await expect(describeVideo(s, 'aaaaaaaaaaa')).rejects.toThrow('Video unavailable')
    expect(asked).toEqual(['VISIONOS'])
  })
})

describe('a description cut to fit its header', () => {
  it('is cut by its bytes, at a whole character', async () => {
    const { cutToBytes } = await import('./downloader.js')
    const lyrics = '夜に駆ける'.repeat(2000)
    const cut = cutToBytes(lyrics, 4000)
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(4000)
    expect(lyrics.startsWith(cut)).toBe(true)
    expect(cut.length).toBe(1333)
    expect(cutToBytes('short', 4000)).toBe('short')
  })
})

describe('a download YouTube says is too many', () => {
  it('stops at a 429 on the player request too, in words taken for a refusal', async () => {
    const { session: s, asked } = session({ value: false })
    ;(s.innertube as unknown as { getBasicInfo: unknown }).getBasicInfo = (
      _videoId: string,
      { client }: { client: string },
    ) => {
      asked.push(client)
      return Promise.reject(
        new Error(
          'Request to https://www.youtube.com/youtubei/v1/player failed with status code 429',
        ),
      )
    }
    const failure = downloadAudio(s, 'aaaaaaaaaaa').catch((error: unknown) => error as Error)
    expect(isRateLimited((await failure).message)).toBe(true)
    expect(asked).toEqual(['VISIONOS'])
  })

  it('stops at the first 429: no fresh link, no other client', async () => {
    const { session: s, asked } = session({ value: false })
    ;(s as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve(new Response('', { status: 429 }))
    const failure = downloadAudio(s, 'aaaaaaaaaaa')
    await expect(failure).rejects.toThrow(/429 Too Many Requests/)
    expect(asked).toEqual(['VISIONOS'])
  })
})

describe('a long YouTube Music description, cut', () => {
  it('keeps the line that says YouTube wrote it', async () => {
    const { cutDescription } = await import('./downloader.js')
    const description = [
      'Provided to YouTube by Label',
      '',
      '曲 · 歌手',
      '',
      'アルバム',
      '',
      '℗ 2003 Label',
      '',
      '作曲: 名前'.repeat(1500),
      '',
      'Auto-generated by YouTube.',
    ].join('\n')
    const cut = cutDescription(description, 4000)
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(4000)
    expect(cut.startsWith('Provided to YouTube by Label\n\n曲 · 歌手')).toBe(true)
    expect(cut.endsWith('\n\nAuto-generated by YouTube.')).toBe(true)
    // And so it is still read as YouTube Music's own: the album is still found.
    expect(musicCredits(cut)).toEqual({ track: '曲', artist: '歌手', album: 'アルバム' })
    expect(cutDescription('short', 4000)).toBe('short')
  })
})

describe('a request YouTube never answers', () => {
  it('is given up on, and the caller’s own stop still stops it', async () => {
    const { withTimeout } = await import('./transport.js')
    const never = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof fetch
    await expect(withTimeout(never, 20)('https://www.youtube.com/')).rejects.toThrow(
      /did not answer/,
    )
    const stop = new AbortController()
    const asked = withTimeout(never, 60_000)('https://www.youtube.com/', { signal: stop.signal })
    stop.abort(new Error('stopped'))
    await expect(asked).rejects.toThrow('stopped')
  })
})

describe('how long a minter is kept', () => {
  it('is four fifths of its token’s life, and never past six hours', async () => {
    const { minterLifetimeMs } = await import('./poToken.js')
    expect(minterLifetimeMs({ ttlSeconds: 3600 })).toBe(2_880_000)
    expect(minterLifetimeMs({ ttlSeconds: 43_200 })).toBe(6 * 60 * 60 * 1000)
    // The page's minter in the sandbox says nothing of its token.
    expect(minterLifetimeMs({ mint: () => Promise.resolve('') })).toBe(6 * 60 * 60 * 1000)
    expect(minterLifetimeMs(null)).toBe(6 * 60 * 60 * 1000)
  })
})
