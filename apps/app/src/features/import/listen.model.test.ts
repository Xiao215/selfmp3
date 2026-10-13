import { describe, expect, it, vi } from 'vitest'
import {
  canListen,
  createSilenceWatch,
  followAudio,
  listenDetail,
  listenLabel,
  listeningLeftReview,
  previewStatus,
  startListening,
  waitingRowNext,
} from './listen.model'

const track = {
  url: 'https://www.youtube.com/watch?v=dGZqpVCJP3k',
  title: '群青',
  artist: 'YOASOBI',
  duration: 248,
  thumbnail: 'https://yt3.test/gunjou=w544-h544-l90-rj',
}

describe('listening before importing', () => {
  it('plays only what yt-dlp can find on YouTube or 网易云', () => {
    expect(canListen({ url: track.url })).toBe(true)
    expect(canListen({ url: 'https://music.163.com/song?id=1973665667' })).toBe(true)
    expect(canListen({ url: 'https://open.spotify.com/track/1' })).toBe(false)
    // Still being looked for on YouTube: nothing to play yet.
    expect(canListen({ url: '' })).toBe(false)
  })

  it('starts loading, at the preview’s length', () => {
    expect(startListening(track)).toEqual({
      track,
      status: 'loading',
      duration: 248,
      tone: null,
    })
    const tone = { hue: 200, chroma: 0.1, palette: [{ l: 0.6, c: 0.1, h: 200, share: 1 }] }
    expect(startListening(track, tone).tone).toEqual(tone)
  })

  it('keeps the song’s length over what the audio makes of its own', () => {
    const listening = startListening(track)
    expect(followAudio(listening, { status: 'playing', currentTime: 3, duration: 480 })).toEqual({
      track,
      status: 'playing',
      duration: 248,
      tone: null,
    })
  })

  it('is the same preview while only the position moves, so the review is not drawn again', () => {
    const playing = followAudio(startListening(track), {
      status: 'playing',
      currentTime: 3,
      duration: 480,
    })
    expect(followAudio(playing, { status: 'playing', currentTime: 3.25, duration: 480 })).toBe(
      playing,
    )
  })

  it('takes the audio’s length for a song whose length the review does not know', () => {
    const listening = startListening({ ...track, duration: 0 })
    expect(
      followAudio(listening, { status: 'playing', currentTime: 3, duration: NaN }).duration,
    ).toBe(0)
    expect(
      followAudio(listening, { status: 'playing', currentTime: 3, duration: 250.5 }).duration,
    ).toBe(250.5)
  })

  it('stops when the track leaves the review', () => {
    const listening = startListening(track)
    expect(listeningLeftReview(listening, [{ url: track.url }])).toBe(false)
    expect(listeningLeftReview(listening, [{ url: 'https://www.youtube.com/watch?v=other' }])).toBe(
      true,
    )
    expect(listeningLeftReview(listening, null)).toBe(true)
    expect(listeningLeftReview(null, null)).toBe(false)
  })

  it('names the button by what pressing it does', () => {
    expect(listenLabel('群青', null)).toBe('Listen to 群青')
    expect(listenLabel('群青', 'paused')).toBe('Listen to 群青')
    expect(listenLabel('群青', 'playing')).toBe('Pause 群青')
  })

  it('says why a preview would not play', () => {
    expect(listenDetail({ track, status: 'playing' })).toBe('YOASOBI')
    expect(listenDetail({ track: { ...track, artist: '' }, status: 'paused' })).toBe(
      'Unknown artist',
    )
    expect(listenDetail({ track, status: 'error' })).toBe('Couldn’t play this one from YouTube')
    const netease = { ...track, url: 'https://music.163.com/song?id=1973665667' }
    expect(listenDetail({ track: netease, status: 'error' })).toBe(
      'Couldn’t play this one from 网易云',
    )
  })

  it('opens a waiting row once its song plays, waits while it loads, and forgets it when another song takes the player', () => {
    const loading = startListening(track)
    expect(waitingRowNext(track.url, loading)).toBe('wait')
    expect(waitingRowNext(track.url, { ...loading, status: 'playing' })).toBe('open')
    expect(waitingRowNext(track.url, { ...loading, status: 'error' })).toBe('open')
    expect(waitingRowNext(track.url, null)).toBe('open')
    expect(
      waitingRowNext('https://www.youtube.com/watch?v=other000000', {
        ...loading,
        status: 'playing',
      }),
    ).toBe('forget')
  })
})

describe('what a preview is doing, on a phone and in a browser alike', () => {
  it('is loading while asked to play and still waiting, and playing once it sounds', () => {
    expect(previewStatus('play', { failed: false, ready: false })).toBe('loading')
    expect(previewStatus('play', { failed: false, ready: true })).toBe('playing')
  })

  it('is paused when asked to pause, whatever its buffer is doing', () => {
    expect(previewStatus('pause', { failed: false, ready: false })).toBe('paused')
  })

  it('says it failed either way', () => {
    expect(previewStatus('pause', { failed: true, ready: true })).toBe('error')
  })

  it('counts a stream silent for too long as failed, and not one that spoke', () => {
    vi.useFakeTimers()
    try {
      const silent = vi.fn()
      const watch = createSilenceWatch(silent)

      watch.watch()
      watch.heard('loading')
      vi.advanceTimersByTime(45_000)
      expect(silent).toHaveBeenCalledTimes(1)

      watch.watch()
      watch.heard('playing')
      vi.advanceTimersByTime(60_000)
      expect(silent).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
