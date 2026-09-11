import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { LocalStorageDriver } from '../storage/local.js'
import { LyricsService } from './lyrics.js'

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
