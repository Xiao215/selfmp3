import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { LocalStorageDriver } from '../storage/local.js'
import { LyricsService } from './lyrics.js'
import type { YouTubeMusicLyrics } from './youtubeMusic.js'

/**
 * lrclib lookups against a fake network, with a real library folder on disk.
 *
 * What matters most here is the instrumental answer: it is remembered on the
 * song and stops future lookups, so a wrong "instrumental" is sticky. The
 * tests pin down when lrclib is believed and that nothing is written to disk
 * for a song with no words.
 */

const song = { artist: 'Aurora Lane', title: 'Midnight Drive', album: 'Night', duration: 254 }

/** Answers lrclib's two endpoints separately and records what was asked. */
function fakeLrclib(answers: { get?: unknown; search?: unknown }) {
  const calls: string[] = []
  const fetchImpl = (url: string): Promise<Response> => {
    calls.push(url)
    const body = url.includes('/api/get?') ? answers.get : answers.search
    return Promise.resolve(
      body === undefined ? new Response('', { status: 404 }) : Response.json(body),
    )
  }
  return { fetchImpl, calls }
}

describe('LyricsService', () => {
  let root: string
  let storage: LocalStorageDriver

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-lyrics-'))
    storage = new LocalStorageDriver(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const service = (answers: { get?: unknown; search?: unknown }) => {
    const lrclib = fakeLrclib(answers)
    return { lyrics: new LyricsService(storage, createLogger('silent'), lrclib.fetchImpl), lrclib }
  }

  describe('fetchRemote', () => {
    it('reports an exact match flagged instrumental', async () => {
      const { lyrics } = service({
        get: { instrumental: true, plainLyrics: null, syncedLyrics: null },
      })
      expect(await lyrics.fetchRemote(song)).toBe('instrumental')
    })

    it('does not believe the fuzzy search about a track being instrumental', async () => {
      const { lyrics } = service({ search: [{ instrumental: true }] })
      expect(await lyrics.fetchRemote(song)).toBeNull()
    })

    it('returns lyrics, synced over plain', async () => {
      const { lyrics } = service({
        get: { instrumental: false, plainLyrics: 'la la', syncedLyrics: '[00:01.00]la la' },
      })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: '[00:01.00]la la', synced: true })
    })

    it('falls back to the search when there is no exact match', async () => {
      const { lyrics } = service({ search: [{ plainLyrics: 'la la' }] })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: 'la la', synced: false })
    })

    it('does not search when the exact match is timed', async () => {
      const { lyrics, lrclib } = service({
        get: { syncedLyrics: '[00:01.00]exact', duration: 254 },
        search: [{ syncedLyrics: '[00:01.00]other', duration: 254 }],
      })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: '[00:01.00]exact', synced: true })
      expect(lrclib.calls).toHaveLength(1)
    })

    // 群青, as lrclib has it: the exact match is an untimed upload, and the
    // first timed search result is the music video, fourteen seconds longer.
    it('looks past an untimed exact match for the timed upload closest in length', async () => {
      const { lyrics } = service({
        get: { plainLyrics: 'words', duration: 254 },
        search: [
          { syncedLyrics: '[00:15.00]video', duration: 268 },
          { syncedLyrics: '[00:01.00]near', duration: 254.9 },
          { syncedLyrics: '[00:01.00]nearest', duration: 254.2 },
        ],
      })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: '[00:01.00]nearest', synced: true })
    })

    it('keeps the exact words over timings more than a second out', async () => {
      const { lyrics } = service({
        get: { plainLyrics: 'words', duration: 254 },
        search: [{ syncedLyrics: '[00:15.00]video', duration: 255.5 }],
      })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: 'words', synced: false })
    })

    it('prefers plain words from the search to timings from another recording', async () => {
      const { lyrics } = service({
        search: [
          { syncedLyrics: '[00:15.00]video', plainLyrics: 'video words', duration: 268 },
          { plainLyrics: 'album words', duration: 254 },
        ],
      })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: 'album words', synced: false })
    })

    it('replaces a timed exact match more than a second out with a closer one', async () => {
      const { lyrics } = service({
        get: { syncedLyrics: '[00:01.00]exact', duration: 255.6 },
        search: [{ syncedLyrics: '[00:01.00]closer', duration: 254.4 }],
      })
      expect(await lyrics.fetchRemote(song)).toEqual({ text: '[00:01.00]closer', synced: true })
    })

    it('takes the first timed result when the song has no length to compare', async () => {
      const { lyrics } = service({
        search: [{ plainLyrics: 'words' }, { syncedLyrics: '[00:01.00]first', duration: 300 }],
      })
      expect(await lyrics.fetchRemote({ ...song, duration: 0 })).toEqual({
        text: '[00:01.00]first',
        synced: true,
      })
    })
  })

  describe('with YouTube Music', () => {
    const youtubeMusic = (lrc: string | null) => {
      const asked: unknown[] = []
      const fake = {
        find: (input: unknown) => {
          asked.push(input)
          return Promise.resolve(lrc)
        },
      } as unknown as YouTubeMusicLyrics
      return { fake, asked }
    }

    it('takes its timed lyrics before asking lrclib, by the video the song came from', async () => {
      const { fake, asked } = youtubeMusic('[00:01.00]from youtube')
      const lrclib = fakeLrclib({ get: { syncedLyrics: '[00:01.00]from lrclib' } })
      const lyrics = new LyricsService(storage, createLogger('silent'), lrclib.fetchImpl, fake)

      expect(
        await lyrics.fetchRemote({ ...song, sourceUrl: 'https://youtu.be/fCh0qfxElm8' }),
      ).toEqual({ text: '[00:01.00]from youtube', synced: true })
      expect(asked).toEqual([
        { videoId: 'fCh0qfxElm8', artist: song.artist, title: song.title, duration: 254 },
      ])
      expect(lrclib.calls).toEqual([])
    })

    it('falls back to lrclib when YouTube Music has nothing', async () => {
      const { fake } = youtubeMusic(null)
      const lrclib = fakeLrclib({ get: { syncedLyrics: '[00:01.00]from lrclib' } })
      const lyrics = new LyricsService(storage, createLogger('silent'), lrclib.fetchImpl, fake)
      expect(await lyrics.fetchRemote(song)).toEqual({
        text: '[00:01.00]from lrclib',
        synced: true,
      })
    })
  })

  describe('writeSidecar', () => {
    it('replaces plain lyrics with timed ones, leaving one file', async () => {
      await storage.write('Midnight Drive.txt', Buffer.from('words'))
      const { lyrics } = service({})
      await lyrics.writeSidecar('Midnight Drive.mp3', '[00:01.00]words', true)
      expect(await storage.exists('Midnight Drive.lrc')).toBe(true)
      expect(await storage.exists('Midnight Drive.txt')).toBe(false)
    })
  })

  describe('resolve', () => {
    it('passes the instrumental answer through and writes no sidecar', async () => {
      const { lyrics } = service({ get: { instrumental: true } })
      expect(await lyrics.resolve('Midnight Drive.mp3', null, song)).toBe('instrumental')
      expect(await lyrics.findSidecar('Midnight Drive.mp3')).toBeNull()
    })

    it('stays off the network without remote input', async () => {
      const { lyrics, lrclib } = service({ get: { plainLyrics: 'la la' } })
      expect(await lyrics.resolve('Midnight Drive.mp3', null, null)).toBeNull()
      expect(lrclib.calls).toEqual([])
    })

    it('prefers a local sidecar over whatever lrclib says', async () => {
      await storage.write('Midnight Drive.lrc', Buffer.from('[00:01.00]mine'))
      const { lyrics, lrclib } = service({ get: { instrumental: true } })
      expect(await lyrics.resolve('Midnight Drive.mp3', null, song)).toMatchObject({
        source: 'sidecar',
        text: '[00:01.00]mine',
      })
      expect(lrclib.calls).toEqual([])
    })

    it('saves found lyrics as a sidecar', async () => {
      const { lyrics } = service({ get: { syncedLyrics: '[00:01.00]la la' } })
      expect(await lyrics.resolve('Midnight Drive.mp3', null, song)).toMatchObject({
        source: 'remote',
        kind: 'synced',
      })
      expect(await lyrics.findSidecar('Midnight Drive.mp3')).toEqual({
        key: 'Midnight Drive.lrc',
        extension: '.lrc',
      })
    })
  })
})
