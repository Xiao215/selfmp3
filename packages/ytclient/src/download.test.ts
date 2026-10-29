import { describe, expect, it } from 'vitest'
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
