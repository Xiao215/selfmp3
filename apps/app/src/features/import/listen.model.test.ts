import { describe, expect, it } from 'vitest'
import {
  canListen,
  followAudio,
  listenDetail,
  listenLabel,
  listeningLeftReview,
  playedRatio,
  seekAt,
  startListening,
} from './listen.model'

const track = {
  url: 'https://www.youtube.com/watch?v=dGZqpVCJP3k',
  title: '群青',
  artist: 'YOASOBI',
  duration: 248,
}

describe('listening before importing', () => {
  it('plays only what yt-dlp can find on YouTube', () => {
    expect(canListen({ url: track.url })).toBe(true)
    expect(canListen({ url: 'https://open.spotify.com/track/1' })).toBe(false)
  })

  it('starts loading, at the preview’s length', () => {
    expect(startListening(track)).toEqual({
      track,
      status: 'loading',
      currentTime: 0,
      duration: 248,
    })
  })

  it('takes the audio’s length once it knows, and keeps the preview’s until then', () => {
    const listening = startListening(track)
    expect(
      followAudio(listening, { status: 'playing', currentTime: 3, duration: NaN }).duration,
    ).toBe(248)
    expect(followAudio(listening, { status: 'playing', currentTime: 3, duration: 250.5 })).toEqual({
      track,
      status: 'playing',
      currentTime: 3,
      duration: 250.5,
    })
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
  })

  it('fills the bar to where the song is, and nothing before its length is known', () => {
    expect(playedRatio(62, 248)).toBeCloseTo(0.25)
    expect(playedRatio(300, 248)).toBe(1)
    expect(playedRatio(-1, 248)).toBe(0)
    expect(playedRatio(10, 0)).toBe(0)
    expect(playedRatio(10, NaN)).toBe(0)
  })

  it('seeks to where the bar is dragged, kept within the song', () => {
    expect(seekAt(50, 200, 248)).toBe(62)
    expect(seekAt(-20, 200, 248)).toBe(0)
    expect(seekAt(260, 200, 248)).toBe(248)
    expect(seekAt(50, 0, 248)).toBe(0)
  })
})
