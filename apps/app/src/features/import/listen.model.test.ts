import { describe, expect, it } from 'vitest'
import {
  canListen,
  followAudio,
  listenDetail,
  listenLabel,
  listeningLeftReview,
  startListening,
} from './listen.model'

const track = { url: 'https://www.youtube.com/watch?v=dGZqpVCJP3k', title: '群青', artist: 'YOASOBI', duration: 248 }

describe('listening before importing', () => {
  it('plays only what yt-dlp can find on YouTube', () => {
    expect(canListen({ url: track.url })).toBe(true)
    expect(canListen({ url: 'https://open.spotify.com/track/1' })).toBe(false)
  })

  it('starts loading, at the preview’s length', () => {
    expect(startListening(track)).toEqual({ track, status: 'loading', currentTime: 0, duration: 248 })
  })

  it('takes the audio’s length once it knows, and keeps the preview’s until then', () => {
    const listening = startListening(track)
    expect(followAudio(listening, { status: 'playing', currentTime: 3, duration: NaN }).duration).toBe(248)
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
    expect(listeningLeftReview(listening, [{ url: 'https://www.youtube.com/watch?v=other' }])).toBe(true)
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
    expect(listenDetail({ track: { ...track, artist: '' }, status: 'paused' })).toBe('Unknown artist')
    expect(listenDetail({ track, status: 'error' })).toBe('Couldn’t play this one from YouTube')
  })
})
